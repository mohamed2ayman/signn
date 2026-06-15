import { InjectQueue } from '@nestjs/bull';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
} from '../../../database/entities';
import { RiskSourceType } from '../enums/risk-source-type.enum';
import { DriftReportService } from './drift-report.service';
import {
  ResolveDefaultsResult,
  RiskMethodologyResolverService,
} from './risk-methodology-resolver.service';

/**
 * Phase 7.17 — Prompt 1, B.3.
 *
 * Apply a user override to an existing RiskAnalysis row. OWNER_ADMIN
 * only (enforced at the controller layer). One transaction wraps:
 *   - the risk row update (via `repo.save(loadedEntity)` so the
 *     @BeforeUpdate hook fires and recomputes `risk_score`)
 *   - the append-only audit log insert into `risk_analysis_override_log`
 *
 * After commit (NOT inside the transaction):
 *   - resolver cache invalidated for (org, category) across all
 *     jurisdictions — prevents stale reads during cache TTL
 *   - learned-baseline recompute job enqueued (B.4 worker consumes;
 *     B.4 itself checks the override-count threshold ≥10)
 *
 * Drift warning logic: BEFORE the transaction, the service calls the
 * resolver to compute the current default L,I for this category. If
 * the user's override is >2 points BELOW the default on either axis,
 * a `drift_warning` payload is returned alongside the updated row.
 * Drift is warn-only — the server never rejects the override; the UI
 * surfaces the warning so the user can confirm.
 */
@Injectable()
export class RiskOverrideService {
  private readonly logger = new Logger(RiskOverrideService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolver: RiskMethodologyResolverService,
    // B.4 touchpoint — queue exists in module wiring; the consuming
    // worker is B.4's scope. Until B.4 lands, jobs accumulate in Redis
    // (Bull's standard "pending work" behaviour).
    @InjectQueue('learned-baseline')
    private readonly baselineQueue: Queue,
    // B.5 touchpoint — invalidate the org's cached drift report after
    // every override. One-way edge only: this service depends on
    // DriftReportService; DriftReportService must NOT import this one.
    private readonly driftReport: DriftReportService,
  ) {}

  async applyOverride(input: {
    riskId: string;
    userId: string;
    orgId: string;
    likelihood: number;
    impact: number;
    note?: string;
  }): Promise<{ risk: RiskAnalysis; drift_warning: DriftWarning | null }> {
    const { riskId, userId, orgId, likelihood, impact, note } = input;

    // ── 1. Load risk with org-ownership join ────────────────────────
    // risk_analyses has no direct org_id — go through contract→project
    // →org. Both project_id and organization_id are NOT NULL (verified
    // against contract.entity.ts:109 and project.entity.ts:22), so
    // innerJoin cannot silently exclude a legitimate row.
    const risk = await this.dataSource // lint-exempt: parked — inline-join-scoped (centralization pending)
      .getRepository(RiskAnalysis)
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('r.id = :riskId', { riskId })
      .andWhere('p.organization_id = :orgId', { orgId })
      .getOne();
    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }

    // ── 2. v1 source-symmetry guard (per Correction 1 from B.3 plan) ─
    // The override log captures a SINGLE previous_source value. v1's
    // contract from B.1's resolver is `likelihood_source === impact_source`
    // (always assigned together from the same chain step). If a future
    // phase introduces asymmetric sources, this guard fires and forces
    // a deliberate schema split of `previous_source` into two columns
    // before this code can proceed. See the TSDoc on
    // RiskAnalysisOverrideLog.previous_source for the migration plan.
    if (risk.likelihood_source !== risk.impact_source) {
      throw new InternalServerErrorException(
        `Override service v1 assumes uniform L/I source; risk ${risk.id} has ` +
          `likelihood_source=${risk.likelihood_source} impact_source=${risk.impact_source}. ` +
          `This indicates a future-phase write path that this code does not yet support — ` +
          `extend override log schema to split previous_source into two columns before proceeding.`,
      );
    }

    // ── 3. Resolve CURRENT defaults for drift calc (read-through cache) ─
    const resolved = await this.resolver.resolveDefaults({
      organizationId: orgId,
      riskCategory: risk.risk_category,
      // jurisdictionVariant intentionally omitted in v1 — A.3 seeds
      // with variants aren't in yet. A future enhancement looks up
      // the contract's jurisdiction and passes it here.
    });

    // ── 4. Compute drift warning (null when within tolerance) ───────
    const driftWarning = this.computeDrift({ likelihood, impact }, resolved);

    // ── 5. Snapshot pre-override state for the log row ──────────────
    const previousLikelihood = risk.likelihood;
    const previousImpact = risk.impact;
    const previousSource = risk.likelihood_source; // symmetric per guard above

    // ── 6. Apply override + insert log atomically ───────────────────
    // dataSource.transaction(async em => ...) is the codebase's canonical
    // transaction pattern (see admin-security/security-event.service.ts:70).
    // If either op throws, both roll back. The risk row update fires
    // the @BeforeUpdate hook (mutated entity via em.save) → risk_score
    // recomputed from the new L,I.
    const updatedRisk = await this.dataSource.transaction(async (em) => {
      risk.likelihood = likelihood;
      risk.impact = impact;
      risk.likelihood_source = RiskSourceType.USER_OVERRIDE;
      risk.impact_source = RiskSourceType.USER_OVERRIDE;
      risk.last_overridden_by = userId;
      risk.last_overridden_at = new Date();

      const saved = await em.getRepository(RiskAnalysis).save(risk); // lint-exempt: parked — inline-join-scoped (centralization pending)

      await em.getRepository(RiskAnalysisOverrideLog).insert({ // lint-exempt: parked — inline-join-scoped (centralization pending)
        risk_analysis_id: riskId,
        organization_id: orgId,
        risk_category: risk.risk_category,
        previous_likelihood: previousLikelihood,
        previous_impact: previousImpact,
        new_likelihood: likelihood,
        new_impact: impact,
        previous_source: previousSource,
        user_id: userId,
        note: note ?? null,
      });

      return saved;
    });

    // ── 7. Post-commit cache invalidation (NOT inside the txn) ──────
    // Invalidating inside the transaction would race: a concurrent read
    // between cache-clear and commit would repopulate the cache with
    // pre-commit (stale) values. Doing it after commit bounds staleness
    // to one in-flight read at most.
    this.resolver.invalidate(orgId, risk.risk_category);

    // B.5 touchpoint — drop the org's cached drift report so the next
    // OWNER_ADMIN read of /settings/risk-drift reflects this override.
    this.driftReport.invalidate(orgId);

    // ── 8. B.4 touchpoint — enqueue learned-baseline recompute ──────
    // ALWAYS enqueue; B.4 itself checks the override-count ≥10
    // threshold and is a no-op below it. Try/catch so a Redis hiccup
    // does NOT fail the override response — the override has already
    // committed; missing one baseline recompute is a degraded mode,
    // not a failure mode.
    try {
      await this.baselineQueue.add('recompute', {
        organizationId: orgId,
        riskCategory: risk.risk_category,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue learned-baseline recompute for org=${orgId} ` +
          `category=${risk.risk_category}: ${(err as Error).message}`,
      );
    }

    return { risk: updatedRisk, drift_warning: driftWarning };
  }

  /**
   * Returns null when override is within tolerance (≤2 below default
   * on both L and I), otherwise a structured warning payload.
   *
   * "Below" means lower number — the user is rating the finding as
   * LESS severe than the calibrated default. Overrides ABOVE the
   * default (user is more pessimistic) are not flagged.
   */
  private computeDrift(
    override: { likelihood: number; impact: number },
    resolved: ResolveDefaultsResult,
  ): DriftWarning | null {
    const lDelta = resolved.likelihood - override.likelihood;
    const iDelta = resolved.impact - override.impact;
    if (lDelta <= 2 && iDelta <= 2) {
      return null;
    }
    return {
      likelihood_delta: lDelta,
      impact_delta: iDelta,
      resolved_likelihood: resolved.likelihood,
      resolved_impact: resolved.impact,
      resolved_source: resolved.likelihood_source,
      citation: resolved.platform_default_ref_id
        ? `platform_default:${resolved.platform_default_ref_id}`
        : undefined,
    };
  }
}

export interface DriftWarning {
  likelihood_delta: number;
  impact_delta: number;
  resolved_likelihood: number;
  resolved_impact: number;
  resolved_source: RiskSourceType;
  citation?: string;
}
