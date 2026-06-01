import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  AssetReviewStatus,
  KnowledgeAsset,
} from '../../../database/entities';

export interface KnowledgeContextResult {
  /** Concatenated text from STANDARD-tagged assets. */
  standard_knowledge: string | null;
  /** Concatenated text from MANDATORY_LAW + CONFLICT_GUIDE assets. */
  jurisdiction_knowledge: string | null;
  /** Concatenated text from PLAYBOOK assets in the org. */
  playbook_knowledge: string | null;
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
  ) {}

  async buildContext(input: {
    orgId: string | null;
    jurisdiction: string | null;
    contractType: string | null;
    /** Phase 7.24e — when supplied, project-scoped assets are included. */
    projectId?: string | null;
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

    return {
      standard_knowledge: this.formatAssets(standardAssets),
      jurisdiction_knowledge: this.formatAssets(jurisdictionAssets),
      playbook_knowledge: this.formatAssets(playbookAssets),
      asset_ids: Array.from(ids),
    };
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

  private formatAssets(assets: KnowledgeAsset[]): string | null {
    if (assets.length === 0) return null;
    const parts: string[] = [];
    let charCount = 0;
    for (const asset of assets) {
      const block = this.renderAssetBlock(asset);
      if (charCount + block.length > ComplianceKnowledgeService.MAX_SECTION_CHARS) {
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
