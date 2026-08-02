import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  AssetReviewStatus,
  KnowledgeAsset,
  PlaybookPosition,
} from '../../../database/entities';
import { PlaybookResolverService } from '../../playbook/playbook-resolver.service';
import { serializePlaybookPositions } from '../../playbook/playbook-serializer.util';

/**
 * 7.22 Item 1 — a resolved playbook position in AI-ready shape (loose
 * value_config; the typed shape lives on the entity). Sent to the compliance
 * agent alongside the prose playbook_knowledge.
 */
export interface PlaybookPositionForAI {
  position_id: string;
  clause_type: string;
  rule_type: string;
  value_config: Record<string, unknown>;
}

export interface KnowledgeContextResult {
  /** Concatenated text from STANDARD-tagged assets. */
  standard_knowledge: string | null;
  /** Concatenated text from MANDATORY_LAW + CONFLICT_GUIDE assets. */
  jurisdiction_knowledge: string | null;
  /**
   * The org's playbook context.
   *
   * 7.22 Slice 2 — this channel now carries TWO bodies of text: the org's
   * STRUCTURED standard positions (playbook_positions, resolved for this
   * contract's scope) FIRST, then the free-text PLAYBOOK knowledge assets that
   * have always fed it. Either half may be absent; null means neither exists.
   */
  playbook_knowledge: string | null;
  /** 7.22 Item 1 — resolved positions in AI-ready shape (same resolve as the prose). */
  playbook_positions: PlaybookPositionForAI[];
  /** All asset IDs that contributed text — stored on ComplianceCheck.knowledge_assets_used. */
  asset_ids: string[];
}

/**
 * Builds the per-check knowledge context that the compliance AI receives.
 *
 *   - SIGN platform-wide assets: organization_id IS NULL
 *   - Org-private assets:        organization_id = orgId
 *
 * Selection rules:
 *   - Asset must be APPROVED or AUTO_APPROVED
 *   - Filtered to the right tag bucket (standard / jurisdiction / playbook)
 *
 * Output text is bounded — each section caps at MAX_SECTION_CHARS so a
 * very large knowledge base doesn't blow Claude's context window. Within
 * a section, assets with structured `content` jsonb are formatted as
 * "## Title — citation\n<articles>"; otherwise the description is used.
 */
@Injectable()
export class ComplianceKnowledgeService {
  private readonly logger = new Logger(ComplianceKnowledgeService.name);

  /** Per-section soft cap on text size (~30k tokens of context total). */
  private static readonly MAX_SECTION_CHARS = 30_000;

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly assetRepo: Repository<KnowledgeAsset>,
    // 7.22 Slice 2 — the org's structured playbook positions. READ-ONLY here;
    // the CRUD surface (PlaybookService) is deliberately not injected.
    private readonly playbookResolver: PlaybookResolverService,
  ) {}

  async buildContext(input: {
    orgId: string | null;
    jurisdiction: string | null;
    contractType: string | null;
    /** Phase 7.24e — when supplied, project-scoped assets are included. */
    projectId?: string | null;
    /**
     * 7.22 Slice 2 — when supplied, CONTRACT-scoped playbook overrides for this
     * contract win over the project/org positions. Optional: with it absent the
     * playbook resolves at org+project scope, which is correct, just less
     * specific. No CALLER passes it yet — threading it from
     * ComplianceService.runCheck is a separate one-line change.
     */
    contractId?: string | null;
  }): Promise<KnowledgeContextResult> {
    const [standardAssets, jurisdictionAssets, playbookAssets] =
      await Promise.all([
        this.queryByTags(
          input.orgId,
          [
            ...(input.contractType ? [`standard:${input.contractType}`] : []),
            'type:STANDARD',
          ],
          { projectId: input.projectId },
        ),
        this.queryByJurisdictionAndTags(
          input.orgId,
          input.jurisdiction,
          ['type:MANDATORY_LAW', 'type:CONFLICT_GUIDE'],
          input.projectId,
        ),
        // Playbook is org-only; SIGN platform doesn't ship playbooks
        input.orgId
          ? this.queryByTags(input.orgId, ['type:PLAYBOOK', 'type:STANDARD'], {
              orgOnly: true,
              projectId: input.projectId,
            })
          : Promise.resolve([] as KnowledgeAsset[]),
      ]);

    const ids = new Set<string>();
    for (const set of [standardAssets, jurisdictionAssets, playbookAssets]) {
      for (const asset of set) ids.add(asset.id);
    }

    const playbook = await this.buildPlaybookSection(
      input.orgId,
      input.projectId ?? null,
      input.contractId ?? null,
      playbookAssets,
    );

    return {
      standard_knowledge: this.formatAssets(standardAssets),
      jurisdiction_knowledge: this.formatAssets(jurisdictionAssets),
      playbook_knowledge: playbook.text,
      playbook_positions: playbook.positions.map((p) => ({
        position_id: p.id,
        clause_type: p.clause_type,
        rule_type: p.rule_type,
        value_config: p.value_config as unknown as Record<string, unknown>,
      })),
      asset_ids: Array.from(ids),
    };
  }

  /**
   * 7.22 Slice 2 — the playbook channel: STRUCTURED positions + PLAYBOOK assets.
   *
   * The two coexist by design. The `['type:PLAYBOOK', 'type:STANDARD']` asset
   * query above is UNCHANGED and its text is still emitted — the structured
   * positions are ADDED to it, never a replacement. An org that has authored
   * neither still gets `null`, exactly as before.
   *
   * BUDGET: structured positions go FIRST and get the full section budget,
   * because they are the org's authoritative, explicitly-authored standard
   * positions; the asset text takes whatever remains. The combined text still
   * respects MAX_SECTION_CHARS — the cap is not raised to make room.
   *
   * BEST-EFFORT: a failure resolving the playbook degrades to asset-only text
   * and is logged. A compliance run must not fail because the playbook lookup
   * did (the lesson #114 convention already used across this module).
   */
  private async buildPlaybookSection(
    orgId: string | null,
    projectId: string | null,
    contractId: string | null,
    playbookAssets: KnowledgeAsset[],
  ): Promise<{ text: string | null; positions: PlaybookPosition[] }> {
    const cap = ComplianceKnowledgeService.MAX_SECTION_CHARS;

    let structured: string | null = null;
    let positions: PlaybookPosition[] = [];
    if (orgId) {
      try {
        positions = await this.playbookResolver.resolveEffectivePositions(
          orgId,
          { projectId, contractId },
        );
        structured = serializePlaybookPositions(positions, { maxChars: cap });
      } catch (err) {
        this.logger.warn(
          `[playbook] Failed to resolve structured positions for org ${orgId}: ${
            (err as Error).message
          } — falling back to playbook assets only.`,
        );
      }
    }

    // Two blank-line separator, matching how formatAssets joins its own blocks.
    const remaining = structured ? cap - structured.length - 2 : cap;
    let assetText =
      remaining > 0 ? this.formatAssets(playbookAssets, remaining) : null;

    // formatAssets budgets by BLOCK length alone — it counts neither the '\n\n'
    // it joins blocks with nor the truncation marker it appends, so its output
    // can legitimately run past the budget it was handed (invisible with one
    // oversized asset, but compounding two chars at a time across many small
    // ones). The section cap is a hard promise on this path, so clamp rather
    // than trust the number we passed down.
    if (assetText && assetText.length > remaining) {
      assetText = this.clampToLength(assetText, remaining) || null;
    }

    // Ops signal: the org's playbook ASSETS were squeezed out of the prompt by
    // the structured positions. That is the intended priority order, but it is
    // silent from the model's side, so it should not be silent from ours.
    if (structured && playbookAssets.length > 0 && !assetText) {
      this.logger.warn(
        `[playbook] Structured positions filled the ${cap}-char section budget; ` +
          `${playbookAssets.length} playbook knowledge asset(s) were omitted from the prompt.`,
      );
    }

    const combined =
      structured && assetText
        ? `${structured}\n\n${assetText}`
        : (structured ?? assetText);
    if (!combined) return { text: null, positions };

    // ABSOLUTE BACKSTOP. Both halves budget themselves, but each does so with
    // its own arithmetic; this is the one place the section cap is actually
    // guaranteed rather than merely intended. Structured positions were placed
    // first precisely so that what a clamp here removes is the lower-priority
    // asset tail.
    const text =
      combined.length > cap ? this.clampToLength(combined, cap) : combined;
    return { text, positions };
  }

  /**
   * Hard-truncate to `max` UTF-16 units without splitting a surrogate pair —
   * cutting between the halves of an astral-plane character would emit a lone
   * surrogate. (Arabic is BMP and unaffected; emoji in an asset title are not.)
   */
  private clampToLength(text: string, max: number): string {
    if (max <= 0) return '';
    if (text.length <= max) return text;
    const lastUnit = text.charCodeAt(max - 1);
    const splitsSurrogatePair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
    return text.slice(0, splitsSurrogatePair ? max - 1 : max);
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Query approved assets that have ANY of the given tag strings.
   *
   * Visibility tiers (Phase 7.24e):
   *   - Default (orgId + optional projectId):
   *       platform (org_id IS NULL AND project_id IS NULL)
   *       + org-wide (org_id = orgId AND project_id IS NULL)
   *       + project (org_id = orgId AND project_id = projectId)  ← only when projectId supplied
   *   - orgOnly: org-wide + project assets only (no platform; used for playbooks)
   *   - No orgId: platform-only
   */
  private async queryByTags(
    orgId: string | null,
    tags: string[],
    opts: { orgOnly?: boolean; projectId?: string | null } = {},
  ): Promise<KnowledgeAsset[]> {
    if (tags.length === 0) return [];
    const qb = this.assetRepo
      .createQueryBuilder('a')
      .where('a.review_status IN (:...statuses)', {
        statuses: [AssetReviewStatus.APPROVED, AssetReviewStatus.AUTO_APPROVED],
      })
      .andWhere(
        new Brackets((b) => {
          tags.forEach((tag, i) => {
            b.orWhere(`a.tags @> :tag${i}::jsonb`, {
              [`tag${i}`]: JSON.stringify([tag]),
            });
          });
        }),
      );

    if (opts.orgOnly && orgId) {
      // Org-wide + (optionally) project-scoped; no platform assets.
      if (opts.projectId) {
        qb.andWhere(
          '(a.organization_id = :orgId AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id = :projectId)',
          { orgId, projectId: opts.projectId },
        );
      } else {
        qb.andWhere(
          'a.organization_id = :orgId AND a.project_id IS NULL',
          { orgId },
        );
      }
    } else if (orgId) {
      // Three-tier (platform + org-wide + project) or two-tier (no projectId).
      if (opts.projectId) {
        qb.andWhere(
          '(a.organization_id IS NULL AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id = :projectId)',
          { orgId, projectId: opts.projectId },
        );
      } else {
        qb.andWhere(
          '(a.organization_id IS NULL AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id IS NULL)',
          { orgId },
        );
      }
    } else {
      // No org context — platform-only.
      qb.andWhere('a.organization_id IS NULL AND a.project_id IS NULL');
    }

    return qb.getMany();
  }

  /**
   * Query assets that match BOTH (jurisdiction:XX in tags OR jurisdiction
   * column matches) AND any of the type-tags.
   *
   * Phase 7.24e: accepts optional projectId for three-tier visibility.
   */
  private async queryByJurisdictionAndTags(
    orgId: string | null,
    jurisdiction: string | null,
    tags: string[],
    projectId?: string | null,
  ): Promise<KnowledgeAsset[]> {
    if (!jurisdiction) return [];
    const jurisdictionTag = `jurisdiction:${jurisdiction}`;
    const qb = this.assetRepo
      .createQueryBuilder('a')
      .where('a.review_status IN (:...statuses)', {
        statuses: [AssetReviewStatus.APPROVED, AssetReviewStatus.AUTO_APPROVED],
      })
      .andWhere(
        new Brackets((b) => {
          b.where('a.jurisdiction = :jur', { jur: jurisdiction }).orWhere(
            'a.tags @> :jurTag::jsonb',
            { jurTag: JSON.stringify([jurisdictionTag]) },
          );
        }),
      )
      .andWhere(
        new Brackets((b) => {
          tags.forEach((tag, i) => {
            b.orWhere(`a.tags @> :tytag${i}::jsonb`, {
              [`tytag${i}`]: JSON.stringify([tag]),
            });
          });
        }),
      );

    if (orgId) {
      if (projectId) {
        qb.andWhere(
          '(a.organization_id IS NULL AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id = :projectId)',
          { orgId, projectId },
        );
      } else {
        qb.andWhere(
          '(a.organization_id IS NULL AND a.project_id IS NULL)' +
            ' OR (a.organization_id = :orgId AND a.project_id IS NULL)',
          { orgId },
        );
      }
    } else {
      qb.andWhere('a.organization_id IS NULL AND a.project_id IS NULL');
    }

    return qb.getMany();
  }

  /**
   * @param maxChars per-section budget. Defaults to the full MAX_SECTION_CHARS
   *   — the standard and jurisdiction sections are unaffected by 7.22. Only the
   *   playbook section passes a reduced budget, so the structured positions it
   *   prepends and this asset text together stay inside one section cap.
   */
  private formatAssets(
    assets: KnowledgeAsset[],
    maxChars: number = ComplianceKnowledgeService.MAX_SECTION_CHARS,
  ): string | null {
    if (assets.length === 0) return null;
    const parts: string[] = [];
    let charCount = 0;
    for (const asset of assets) {
      const block = this.renderAssetBlock(asset);
      if (charCount + block.length > maxChars) {
        parts.push(
          `\n[...truncated — ${assets.length - parts.length} more assets in this category]`,
        );
        break;
      }
      parts.push(block);
      charCount += block.length;
    }
    return parts.join('\n\n');
  }

  private renderAssetBlock(asset: KnowledgeAsset): string {
    const header = `## ${asset.title} (id: ${asset.id})`;
    const content = asset.content as
      | { articles?: Array<{ ref?: string; title?: string; text?: string; citation?: string }>; summary?: string }
      | null
      | undefined;

    if (content && Array.isArray(content.articles) && content.articles.length > 0) {
      const articles = content.articles
        .map((a) => {
          const ref = a.ref ? `[${a.ref}] ` : '';
          const title = a.title ? `${a.title}: ` : '';
          const cite = a.citation ? `\n  Source: ${a.citation}` : '';
          return `- ${ref}${title}${a.text ?? ''}${cite}`;
        })
        .join('\n');
      const summary = content.summary ? `\n\n${content.summary}\n` : '';
      return `${header}\n${summary}${articles}`;
    }

    return `${header}\n${asset.description ?? '(no description)'}`;
  }
}
