import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bull';
import { Repository } from 'typeorm';

import {
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
} from '../../database/entities';
import { RiskMethodologyResolverService } from './services/risk-methodology-resolver.service';
import { computeMedian } from './utils/median';

/** Job payload — emitted by RiskOverrideService.applyOverride (B.3). */
export interface RecomputeBaselineJobData {
  organizationId: string;
  riskCategory: string;
}

/**
 * Minimum override count before a learned baseline is trusted enough to
 * be returned by the resolver's step 2. Mirrors the resolver's own gate
 * in tryStep2() — keep both in sync.
 */
const LEARNED_BASELINE_THRESHOLD = 10;

/** Window of most-recent override-log rows used for the median. */
const LEARNED_BASELINE_SAMPLE_SIZE = 50;

/**
 * Phase 7.17 — Prompt 1, B.4.
 *
 * Consumes the `learned-baseline` queue that B.3's override service
 * enqueues to after every override commit. For each
 * `{ organizationId, riskCategory }` job:
 *
 *   1. Count override-log rows for the pair. Below threshold (10) →
 *      no-op (the resolver won't use a baseline backed by < 10 samples).
 *   2. Load the most-recent 50 override-log rows.
 *   3. Compute median new_likelihood + median new_impact.
 *   4. Upsert into risk_category_org_learned_baselines with the medians
 *      and the TOTAL lifetime override count.
 *   5. Invalidate the resolver cache for (org, category) so the new
 *      baseline becomes visible immediately instead of after TTL.
 *
 * Idempotent + concurrency-safe: median is pure, upsert is last-write-
 * wins on the (org, category) unique constraint, cache invalidation is
 * a no-op when already empty. See the B.4 plan's "Concurrency /
 * idempotency" section for the full reasoning.
 *
 * Failure mode: a thrown handler lands the job in Bull's failed queue
 * (default retry policy = 1 attempt, matching email-queue and
 * obligation-reminders). A failed recompute is degraded-mode tolerable
 * — the resolver keeps serving the previous baseline or falls through.
 */
@Processor('learned-baseline')
export class LearnedBaselineProcessor {
  private readonly logger = new Logger(LearnedBaselineProcessor.name);

  constructor(
    @InjectRepository(RiskAnalysisOverrideLog) // lint-exempt: aggregation (Q3 — learned-baseline/methodology, org-wide)
    private readonly overrideLogRepo: Repository<RiskAnalysisOverrideLog>,
    @InjectRepository(RiskCategoryOrgLearnedBaseline)
    private readonly baselineRepo: Repository<RiskCategoryOrgLearnedBaseline>,
    private readonly resolver: RiskMethodologyResolverService,
  ) {}

  @Process('recompute')
  async handleRecompute(job: Job<RecomputeBaselineJobData>): Promise<void> {
    // By design, EVERY override enqueues a recompute job — there is no
    // sampling or debouncing. The median over ≤50 rows is microseconds
    // and the only cache to invalidate is the single resolver entry for
    // this (org, category). A Phase 9 reviewer looking at Redis queue
    // depth should read "every override = one job" as intentional, not
    // as inefficiency: the alternative (sampled recompute, e.g. every
    // 5th override) would save trivial compute at the cost of baseline
    // staleness. Eager recompute keeps the learned baseline live.
    const { organizationId, riskCategory } = job.data;
    const jobTag = `job=${job.id} org=${organizationId} cat=${riskCategory}`;

    // ── 1. Threshold gate — exit cleanly if below 10 overrides ──────
    // Done at the START of the worker so B.3's enqueue stays
    // unconditional. The moment override #10 lands, this gate passes
    // and the first baseline is written.
    const totalCount = await this.overrideLogRepo.count({ // lint-exempt: aggregation (Q3 — learned-baseline/methodology, org-wide)
      where: { organization_id: organizationId, risk_category: riskCategory },
    });
    if (totalCount < LEARNED_BASELINE_THRESHOLD) {
      this.logger.log(
        `Skipping recompute (${jobTag}): only ${totalCount} overrides, ` +
          `need >= ${LEARNED_BASELINE_THRESHOLD}`,
      );
      return;
    }

    // ── 2. Load most-recent 50 override-log rows ───────────────────
    // Index idx_risk_analysis_override_log_org_cat_created (S.4) makes
    // this an index scan with LIMIT 50.
    const sample = await this.overrideLogRepo.find({ // lint-exempt: aggregation (Q3 — learned-baseline/methodology, org-wide)
      where: { organization_id: organizationId, risk_category: riskCategory },
      order: { created_at: 'DESC' },
      take: LEARNED_BASELINE_SAMPLE_SIZE,
      select: ['new_likelihood', 'new_impact'],
    });

    if (sample.length === 0) {
      // Defensive: count said >= 10 but find returned 0. Possible race
      // if rows were purged between the count and the find. Skip rather
      // than write a baseline from no data.
      this.logger.warn(
        `Sample unexpectedly empty (${jobTag}, totalCount=${totalCount}); skipping`,
      );
      return;
    }

    // ── 3. Compute medians ─────────────────────────────────────────
    const medianL = computeMedian(sample.map((r) => r.new_likelihood));
    const medianI = computeMedian(sample.map((r) => r.new_impact));

    // ── 4. Upsert the baseline row ─────────────────────────────────
    // UNIQUE (organization_id, risk_category) drives the conflict path.
    // override_count is the TOTAL lifetime count (not the 50-row sample
    // size) per Decision 12 — it tells SYSTEM_ADMIN how mature the
    // baseline is. last_recomputed_at refreshed each run.
    await this.baselineRepo.upsert(
      {
        organization_id: organizationId,
        risk_category: riskCategory,
        learned_likelihood: medianL,
        learned_impact: medianI,
        override_count: totalCount,
        last_recomputed_at: new Date(),
      },
      {
        conflictPaths: ['organization_id', 'risk_category'],
        skipUpdateIfNoValuesChanged: false,
      },
    );

    // ── 5. Invalidate resolver cache (after the upsert commits) ─────
    // Without this the resolver's 5-min cache keeps returning the old
    // baseline (or FALLBACK if this was the first recompute) until
    // natural expiry. Same idiom B.3 uses.
    this.resolver.invalidate(organizationId, riskCategory);

    this.logger.log(
      `Recomputed learned baseline (${jobTag}): L=${medianL} I=${medianI} ` +
        `from ${sample.length} samples (total ${totalCount} overrides)`,
    );
  }
}
