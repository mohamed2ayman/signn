import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  KnowledgeAsset,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
} from '../../../database/entities';
import { RiskMethodologyReaderService } from '../../knowledge-assets/services/risk-methodology-reader.service';
import { RiskSourceType } from '../enums/risk-source-type.enum';

/**
 * Phase 7.17 — Prompt 1, B.1.
 *
 * Resolves the L (likelihood) and I (impact) default values for a new
 * RiskAnalysis row using a 4-step priority chain:
 *
 *   1. USER_KB_REFERENCE — org has a Knowledge Base entry flagged with
 *      `is_risk_methodology_source = TRUE` containing a parseable
 *      `content.risk_methodology` block.
 *   2. ORG_LEARNED — org has accumulated ≥10 overrides for this
 *      (org, risk_category) pair; median L and median I are the baseline.
 *   3. PLATFORM_DEFAULT — SIGN's platform-owned research default for this
 *      category (jurisdiction-specific preferred, NULL jurisdiction
 *      falls back next).
 *   4. FALLBACK — conservative L=3, I=3, marked "no reference".
 *
 * The chain never throws on the happy path. DB failures inside any step
 * fall through to the next step (logged as Logger.warn). Invalid input
 * is rejected up-front with BadRequestException — that is the only path
 * that surfaces an error to the caller.
 *
 * Used by:
 *   - AI risk extraction (A.1 + future write site) when inserting a new
 *     RiskAnalysis row.
 *   - Manual risk-finding creation (future B.5 endpoint).
 *   - Override service B.3 reads the *current* default chain via this
 *     same resolver to compute drift warnings.
 *
 * v1 is per-process in-memory cache. See `cache` field below for the
 * scale boundary at which to switch to Redis or a nested-Map structure.
 */
@Injectable()
export class RiskMethodologyResolverService {
  private readonly logger = new Logger(RiskMethodologyResolverService.name);

  /**
   * In-memory cache keyed by `${orgId}|${category}|${jurisdiction ?? 'NONE'}`.
   *
   * Invalidation pattern (`for-of` + `delete` on matching
   * `${orgId}|${category}|*` prefix) is O(n) over total cache size.
   * If the cache grows beyond ~10k entries across all orgs in production,
   * this scan becomes a hotspot — at that point switch to a nested Map
   * structure (`Map<orgId, Map<category, Map<jurisdiction, entry>>>`) or
   * move to Redis (the @Global TokenBlacklistModule already exposes a
   * shared ioredis client for this purpose).
   *
   * Acceptable for v1 single-instance dev.
   */
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 min per spec

  // Internal telemetry — surfaced via _cacheStats() for B.3's cache-invalidation
  // assertion test. Not exposed to admin UI or external metrics in v1.
  private hits = 0;
  private misses = 0;

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly kbRepo: Repository<KnowledgeAsset>,
    // Phase 7.17 — Prompt 1, B.2: structured-jsonb reader for step 1.
    // Injected from KnowledgeAssetsModule (imported by RiskAnalysisModule).
    private readonly reader: RiskMethodologyReaderService,
    // Phase 7.17 — Prompt 1, B.3 + S.3: backs step 2 (ORG_LEARNED).
    // Resolver only returns this baseline when override_count >= 10
    // for the (org, category) pair — see tryStep2() body.
    @InjectRepository(RiskCategoryOrgLearnedBaseline)
    private readonly learnedBaselineRepo: Repository<RiskCategoryOrgLearnedBaseline>,
    // Phase 7.17 — Prompt 1, B.3 + S.2: backs step 3 (PLATFORM_DEFAULT).
    // Jurisdiction-aware lookup: prefer specific variant, fall back to
    // NULL — see tryStep3() body.
    @InjectRepository(RiskCategoryPlatformDefault)
    private readonly platformDefaultRepo: Repository<RiskCategoryPlatformDefault>,
  ) {}

  /**
   * Walk the priority chain and return the L,I defaults for this
   * (org, category, jurisdiction) tuple. Read-through cached.
   *
   * Never throws on the happy path. DB failures cause silent fall-through
   * to the next step (logged warn). Invalid input (empty orgId or empty
   * riskCategory) throws BadRequestException synchronously.
   */
  async resolveDefaults(
    input: ResolveDefaultsInput,
  ): Promise<ResolveDefaultsResult> {
    // Validate input UP-FRONT, before any DB work.
    if (
      !input.organizationId ||
      typeof input.organizationId !== 'string' ||
      input.organizationId.trim() === ''
    ) {
      throw new BadRequestException('organizationId is required');
    }
    if (
      !input.riskCategory ||
      typeof input.riskCategory !== 'string' ||
      input.riskCategory.trim() === ''
    ) {
      throw new BadRequestException('riskCategory is required');
    }

    const key = this.makeCacheKey(input);
    const cached = this.cache.get(key);
    if (
      cached &&
      Date.now() - cached.loadedAt <
        RiskMethodologyResolverService.CACHE_TTL_MS
    ) {
      this.hits++;
      return cached.value;
    }
    this.misses++;

    // Walk the chain. Each step is wrapped in a defensive try/catch HERE
    // as well as inside its own implementation — this is defence in
    // depth: even if a future step author forgets their internal
    // try/catch, the orchestrator still falls through cleanly. The
    // resolver MUST NEVER throw on the read path, because it's called
    // inline during AI risk-analysis writes — a thrown exception would
    // halt the entire extraction pipeline.
    //
    // Step 4 is pure compute and cannot fail.
    const steps = [this.tryStep1, this.tryStep2, this.tryStep3] as const;
    let result: ResolveDefaultsResult | null = null;
    for (let i = 0; i < steps.length; i++) {
      if (result) break;
      try {
        result = await steps[i].call(this, input);
      } catch (err) {
        this.logger.warn(
          `Resolver step ${i + 1} threw outside its own catch (org=${
            input.organizationId
          } category="${input.riskCategory}"): ${(err as Error).message}`,
        );
        result = null; // fall through to next step
      }
    }
    if (!result) result = this.fallback();

    this.cache.set(key, { value: result, loadedAt: Date.now() });
    return result;
  }

  /**
   * Drop every cache entry for this (org, category) pair across all
   * jurisdictions. Called from B.3 (override service) after a user
   * overrides a finding's L,I — the new override may change the learned
   * baseline crossing threshold, which would change the resolver's
   * answer for new findings in this org+category going forward.
   */
  invalidate(organizationId: string, riskCategory: string): void {
    const prefix = `${organizationId}|${riskCategory}|`;
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * @internal Exposed only for B.3 unit tests that assert
   * "cache invalidation actually fires after an override". Do not call
   * from production code — there is no admin-facing reason to read these.
   */
  _cacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * @internal Test-only helper. Resets cache + telemetry between tests.
   */
  _clearCache(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // ─── Private chain steps ─────────────────────────────────────────────

  /**
   * Step 1 — USER_KB_REFERENCE.
   *
   * Look for a KnowledgeAsset in this org flagged as a risk methodology
   * source. Prefer a row whose `risk_methodology_category` exactly
   * matches the requested category; fall back to a generic row (NULL
   * category) if no exact match exists. Order by `updated_at DESC` so
   * the most recently edited row wins ties.
   *
   * The single SQL with `ORDER BY CASE` does the prefer-specific-then-NULL
   * fan-out in one round trip instead of two queries.
   *
   * The KB asset entry's structured methodology block is read by the B.2
   * `parseRiskMethodologyContent` function. While B.2 is a stub
   * returning null, this step effectively short-circuits and the chain
   * falls through to step 2.
   *
   * NOTE: the columns `is_risk_methodology_source` and
   * `risk_methodology_category` are added by the S.5 migration. Until
   * that migration lands, the WHERE filter on the (non-existent) column
   * will cause the query to throw — which is caught and logged below,
   * and the chain falls through. So this step is safe to ship before S.5.
   */
  private async tryStep1(
    input: ResolveDefaultsInput,
  ): Promise<ResolveDefaultsResult | null> {
    try {
      const asset = await this.kbRepo
        .createQueryBuilder('ka')
        .where('ka.organization_id = :orgId', {
          orgId: input.organizationId,
        })
        .andWhere('ka.is_risk_methodology_source = :flag', { flag: true })
        .andWhere(
          '(ka.risk_methodology_category = :cat OR ka.risk_methodology_category IS NULL)',
          { cat: input.riskCategory },
        )
        .orderBy(
          'CASE WHEN ka.risk_methodology_category = :cat THEN 0 ELSE 1 END',
          'ASC',
        )
        .addOrderBy('ka.updated_at', 'DESC')
        .limit(1)
        .getOne();

      if (!asset) return null;

      const parsed = await this.reader.parse(asset);
      if (!parsed) {
        // B.2 reader returned null — either the structured block is
        // missing or it failed validation. The reader itself writes the
        // audit log entry. Resolver just falls through.
        return null;
      }

      return {
        likelihood: parsed.likelihood,
        impact: parsed.impact,
        likelihood_source: RiskSourceType.USER_KB_REFERENCE,
        impact_source: RiskSourceType.USER_KB_REFERENCE,
        kb_reference_id: asset.id,
      };
    } catch (err) {
      this.logger.warn(
        `Resolver step 1 (KB) failed for org=${input.organizationId} ` +
          `category="${input.riskCategory}": ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Step 2 — ORG_LEARNED.
   *
   * Read the org's learned baseline for this category from
   * `risk_category_org_learned_baselines` (S.3 table). Returns the
   * baseline ONLY when `override_count >= 10` — below threshold the
   * resolver falls through to step 3 (platform default) so that orgs
   * which have just begun overriding don't immediately have a noisy
   * 1-override-sample-size baseline applied to every new finding.
   *
   * The baseline rows themselves are written by the B.4 learned-
   * baseline computation job, triggered from B.3's override service
   * once a fresh override pushes (org, category) over the threshold.
   *
   * Returns null when no row exists OR override_count < 10. DB errors
   * are caught + logged + null-returned so the chain continues.
   */
  private async tryStep2(
    input: ResolveDefaultsInput,
  ): Promise<ResolveDefaultsResult | null> {
    try {
      const baseline = await this.learnedBaselineRepo.findOne({
        where: {
          organization_id: input.organizationId,
          risk_category: input.riskCategory,
        },
      });
      if (!baseline || baseline.override_count < 10) {
        return null;
      }
      return {
        likelihood: baseline.learned_likelihood,
        impact: baseline.learned_impact,
        likelihood_source: RiskSourceType.ORG_LEARNED,
        impact_source: RiskSourceType.ORG_LEARNED,
      };
    } catch (err) {
      this.logger.warn(
        `Resolver step 2 (ORG_LEARNED) failed for org=${input.organizationId} ` +
          `category=${input.riskCategory}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Step 3 — PLATFORM_DEFAULT.
   *
   * Read SIGN's platform-owned research default for this category from
   * `risk_category_platform_defaults` (S.2 table). Jurisdiction-aware:
   * prefer a row seeded for the specific variant (FIDIC_RED / NEC /
   * JCT / etc.), fall back to the variant-agnostic NULL row.
   *
   * Single SQL with `ORDER BY CASE` resolves the preference in one
   * round-trip instead of two queries (specific-then-NULL fan-out).
   *
   * Returns PLATFORM_DEFAULT source with `default_likelihood`,
   * `default_impact`, and `platform_default_ref_id = row.id` when
   * found. Returns null when no row matches; DB errors caught + logged
   * + null-returned so the chain falls through to step 4 (FALLBACK).
   *
   * Until A.3 seed migration lands the table is empty — every call
   * falls through. That's correct pre-A.3 behaviour.
   */
  private async tryStep3(
    input: ResolveDefaultsInput,
  ): Promise<ResolveDefaultsResult | null> {
    try {
      const variant = input.jurisdictionVariant ?? null;
      const row = await this.platformDefaultRepo
        .createQueryBuilder('pd')
        .where('pd.risk_category = :cat', { cat: input.riskCategory })
        .andWhere(
          '(pd.jurisdiction_variant = :variant OR pd.jurisdiction_variant IS NULL)',
          { variant },
        )
        // Specific variant first (CASE result 0), then NULL (result 1).
        .orderBy(
          'CASE WHEN pd.jurisdiction_variant = :variant THEN 0 ELSE 1 END',
          'ASC',
        )
        .addOrderBy('pd.created_at', 'DESC')
        .limit(1)
        .getOne();

      if (!row) return null;

      return {
        likelihood: row.default_likelihood,
        impact: row.default_impact,
        likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
        impact_source: RiskSourceType.PLATFORM_DEFAULT,
        platform_default_ref_id: row.id,
      };
    } catch (err) {
      this.logger.warn(
        `Resolver step 3 (PLATFORM_DEFAULT) failed for org=${input.organizationId} ` +
          `category=${input.riskCategory} variant=${input.jurisdictionVariant ?? 'NONE'}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Step 4 — FALLBACK. Pure compute, cannot fail.
   *
   * L=3, I=3 lands in the Medium band (6-14) per the spec's tier rules.
   * Marked FALLBACK so the UI can show a "no reference" badge instead
   * of falsely citing a source.
   */
  private fallback(): ResolveDefaultsResult {
    return {
      likelihood: 3,
      impact: 3,
      likelihood_source: RiskSourceType.FALLBACK,
      impact_source: RiskSourceType.FALLBACK,
    };
  }

  private makeCacheKey(input: ResolveDefaultsInput): string {
    return `${input.organizationId}|${input.riskCategory}|${input.jurisdictionVariant ?? 'NONE'}`;
  }
}

// ─── Public types ───────────────────────────────────────────────────────

export interface ResolveDefaultsInput {
  organizationId: string;
  riskCategory: string;
  /**
   * Optional FIDIC / NEC / JCT variant. When provided, the resolver
   * prefers a platform default seeded for this specific variant; falls
   * back to the variant-agnostic (NULL) row if none exists.
   */
  jurisdictionVariant?: string | null;
}

/**
 * v1 always returns `likelihood_source === impact_source` (both come
 * from the same chain step). The spec keeps them as separate fields so
 * a future phase can mix sources (e.g. L from learned baseline, I from
 * platform default). Callers that need to render a single source label
 * may safely read just one of the two fields today.
 */
export interface ResolveDefaultsResult {
  likelihood: number;
  impact: number;
  likelihood_source: RiskSourceType;
  impact_source: RiskSourceType;
  /** FK to risk_category_platform_defaults.id when source = PLATFORM_DEFAULT. */
  platform_default_ref_id?: string;
  /** FK to knowledge_assets.id when source = USER_KB_REFERENCE. */
  kb_reference_id?: string;
}

interface CacheEntry {
  value: ResolveDefaultsResult;
  loadedAt: number;
}
