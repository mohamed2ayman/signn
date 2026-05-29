import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditLog,
  KnowledgeAsset,
  RiskCategory,
} from '../../../database/entities';

export interface ParsedRiskMethodology {
  likelihood: number;
  impact: number;
}

/**
 * Phase 7.17 — Prompt 1, B.2.
 *
 * Reads and validates the structured risk-methodology block stored
 * inside a KnowledgeAsset's `content` jsonb column. Per operator
 * Decision 2 (no YAML), the block lives under a `risk_methodology` key
 * with the shape:
 *
 *   {
 *     "...existing content fields...": "...",
 *     "risk_methodology": {
 *       "category": "Performance Bond",
 *       "likelihood": 4,
 *       "impact": 5,
 *       "notes": "Optional rationale"
 *     }
 *   }
 *
 * Used by `RiskMethodologyResolverService` step 1: when the resolver
 * finds a KB asset flagged as `is_risk_methodology_source = TRUE`, it
 * calls `parse(asset)` to extract validated L,I values. The reader
 * returns `null` on any failure — at which point the resolver falls
 * through to step 2.
 *
 * **Strictly read-only on the success path.** The only DB writes are
 * the `KB_RISK_REFERENCE_MALFORMED` audit-log entries on validation
 * failure, and those writes are wrapped in try/catch so a logging
 * failure does not propagate up to the caller.
 *
 * Validation order is short-circuit: the FIRST failing rule writes one
 * audit entry and returns null. Subsequent rules are not evaluated.
 * This keeps the audit log noise-free (one finding per malformed
 * asset, not a cascade).
 */
@Injectable()
export class RiskMethodologyReaderService {
  private readonly logger = new Logger(RiskMethodologyReaderService.name);

  constructor(
    @InjectRepository(RiskCategory)
    private readonly riskCategoryRepo: Repository<RiskCategory>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Parse and validate `asset.content.risk_methodology`. Returns
   * `{likelihood, impact}` on success, `null` on any failure (with an
   * audit-log entry recorded for SYSTEM_ADMIN visibility).
   *
   * Always async — the risk_categories lookup (rule 7) is a DB call,
   * and so are the audit-log writes on failure paths.
   */
  async parse(asset: KnowledgeAsset): Promise<ParsedRiskMethodology | null> {
    // ── Rule 1: content must be a non-null object ──────────────────
    if (asset.content == null) {
      await this.recordMalformed(asset, 'content_missing');
      return null;
    }

    // ── Rule 2: content.risk_methodology must be a non-null object ──
    // Note: `Array.isArray` returns true for arrays which are typeof
    // 'object' in JS — we explicitly reject arrays here because the
    // spec calls for an object with named fields, not a list.
    const block = (asset.content as Record<string, unknown>)
      .risk_methodology;
    if (
      block == null ||
      typeof block !== 'object' ||
      Array.isArray(block)
    ) {
      await this.recordMalformed(
        asset,
        'risk_methodology_missing_or_not_object',
      );
      return null;
    }

    const methodology = block as Record<string, unknown>;

    // ── Rule 3: category must be a non-empty string ────────────────
    const category = methodology.category;
    if (
      typeof category !== 'string' ||
      category.trim().length === 0
    ) {
      await this.recordMalformed(asset, 'category_missing_or_invalid', {
        attempted_category_value: category,
        attempted_category_type: typeof category,
      });
      return null;
    }

    // ── Rule 4: likelihood must be an integer in [1, 5] ────────────
    const likelihood = methodology.likelihood;
    if (
      !Number.isInteger(likelihood) ||
      (likelihood as number) < 1 ||
      (likelihood as number) > 5
    ) {
      await this.recordMalformed(asset, 'likelihood_invalid', {
        attempted_likelihood_value: likelihood,
        attempted_likelihood_type: typeof likelihood,
      });
      return null;
    }

    // ── Rule 5: impact must be an integer in [1, 5] ────────────────
    const impact = methodology.impact;
    if (
      !Number.isInteger(impact) ||
      (impact as number) < 1 ||
      (impact as number) > 5
    ) {
      await this.recordMalformed(asset, 'impact_invalid', {
        attempted_impact_value: impact,
        attempted_impact_type: typeof impact,
      });
      return null;
    }

    // ── Rule 6: notes (if present) must be a string ────────────────
    if (
      methodology.notes !== undefined &&
      typeof methodology.notes !== 'string'
    ) {
      await this.recordMalformed(asset, 'notes_not_string', {
        attempted_notes_type: typeof methodology.notes,
      });
      return null;
    }

    // ── Rule 7: category must match an ACTIVE risk_categories row ──
    // The WHERE clause includes is_active = TRUE, so an inactive row
    // is indistinguishable from "no row found" from the caller's
    // perspective — both produce reason='category_not_recognized'.
    const categoryRow = await this.riskCategoryRepo.findOne({
      where: { name: category, is_active: true },
    });
    if (!categoryRow) {
      await this.recordMalformed(asset, 'category_not_recognized', {
        attempted_category_value: category,
      });
      return null;
    }

    // All rules passed — return the validated L,I.
    return {
      likelihood: likelihood as number,
      impact: impact as number,
    };
  }

  /**
   * Write a single audit-log entry capturing what failed. Wrapped in
   * try/catch so an audit-write failure does NOT propagate up to the
   * parse() caller — the reader's contract is "return null on
   * validation failure", not "return null AND successfully record it".
   * If the audit write fails, the failure mode degrades gracefully:
   * the parse() still returns null (resolver still falls through),
   * but the malformed asset goes unrecorded. We log a warning so the
   * operations team has a paper trail of the audit-write failure.
   *
   * Pattern matches `docusign.service.ts:452-469` — the canonical
   * audit-write idiom in this codebase.
   */
  private async recordMalformed(
    asset: KnowledgeAsset,
    reason: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLogRepo.insert({
        user_id: undefined,
        organization_id: asset.organization_id ?? undefined,
        action: 'KB_RISK_REFERENCE_MALFORMED',
        entity_type: 'knowledge_asset',
        entity_id: asset.id,
        new_values: {
          reason,
          risk_methodology_category: asset.risk_methodology_category,
          ...extra,
        } as any,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write KB_RISK_REFERENCE_MALFORMED audit log for ` +
          `asset=${asset.id}: ${(err as Error).message}`,
      );
    }
  }
}
