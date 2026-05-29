import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
} from '../../../database/entities';
import { RiskSourceType } from '../enums/risk-source-type.enum';

/** Round to one decimal place. Used for averaged delta values. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Phase 7.17 — Prompt 1, B.5.
 *
 * Org-wide drift report for the F.3 OWNER_ADMIN dashboard
 * (`GET /settings/risk-drift`). Aggregates the override log to surface
 * categories the org consistently rates BELOW the platform/learned
 * default — a signal that the calibrated default is mis-tuned for this
 * org's risk appetite or contract mix.
 *
 * The report has four parts:
 *   - org_summary: lifetime + trailing-30-day override counts, plus the
 *     org's top-10 most-overridden categories with average L/I deltas.
 *   - drift_alerts: categories that cross the drift threshold
 *     (≥5 overrides AND average downward delta >1.5 on L or I). Computed
 *     by its OWN aggregation query with NO top-10 cap — a lower-volume
 *     category that is strongly drifting must still surface, even if it
 *     never makes the top-10-by-count list. Each alert is enriched with
 *     the current platform default + learned baseline for context.
 *   - fallback_categories (Flag 13): categories with >5 findings whose
 *     likelihood_source is FALLBACK — i.e. the resolver couldn't anchor
 *     them to any methodology (no KB ref, no learned baseline, no
 *     platform default). Tells SYSTEM_ADMIN which categories most need a
 *     platform-default seed.
 *
 * Cached per-org for 5 minutes; B.3's override service invalidates the
 * org's entry on every override so a freshly-overridden org sees the new
 * report on the next read.
 *
 * One-way dependency: B.3 (RiskOverrideService) → this service only. This
 * service MUST NOT import RiskOverrideService (would create a cycle).
 */
@Injectable()
export class DriftReportService {
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 min per spec
  private static readonly DRIFT_MIN_OVERRIDES = 5;
  private static readonly DRIFT_DELTA_THRESHOLD = 1.5;
  private static readonly FALLBACK_MIN_FINDINGS = 5;

  private readonly cache = new Map<string, DriftReportCacheEntry>();

  constructor(
    @InjectRepository(RiskAnalysisOverrideLog)
    private readonly overrideLogRepo: Repository<RiskAnalysisOverrideLog>,
    @InjectRepository(RiskCategoryPlatformDefault)
    private readonly platformDefaultRepo: Repository<RiskCategoryPlatformDefault>,
    @InjectRepository(RiskCategoryOrgLearnedBaseline)
    private readonly baselineRepo: Repository<RiskCategoryOrgLearnedBaseline>,
    @InjectRepository(RiskAnalysis)
    private readonly riskRepo: Repository<RiskAnalysis>,
  ) {}

  async getDriftReport(orgId: string): Promise<DriftReport> {
    // ── Cache check (5-min TTL, keyed by orgId) ──
    const cached = this.cache.get(orgId);
    if (cached && Date.now() - cached.loadedAt < DriftReportService.TTL_MS) {
      return cached.value;
    }

    // ── org_summary: lifetime + trailing-30-day override counts ──
    const lifetimeCount = await this.overrideLogRepo.count({
      where: { organization_id: orgId },
    });
    const thirtyDayCount = await this.overrideLogRepo
      .createQueryBuilder('o')
      .where('o.organization_id = :orgId', { orgId })
      .andWhere("o.created_at >= NOW() - INTERVAL '30 days'")
      .getCount();

    // ── most_overridden_categories: top 10 by count, with avg deltas ──
    const catRows = await this.overrideLogRepo
      .createQueryBuilder('o')
      .select('o.risk_category', 'risk_category')
      .addSelect('COUNT(*)', 'override_count')
      .addSelect('AVG(o.previous_likelihood - o.new_likelihood)', 'avg_l_delta')
      .addSelect('AVG(o.previous_impact - o.new_impact)', 'avg_i_delta')
      .where('o.organization_id = :orgId', { orgId })
      .groupBy('o.risk_category')
      .orderBy('"override_count"', 'DESC')
      .limit(10)
      .getRawMany();

    // ── drift_alerts: OWN aggregation query, NO top-10 cap. The HAVING
    //    clause filters server-side so only threshold-crossing categories
    //    come back — a strongly-drifting low-volume category surfaces here
    //    even though it would never make the top-10-by-count list above.
    const alertRows = await this.overrideLogRepo
      .createQueryBuilder('o')
      .select('o.risk_category', 'risk_category')
      .addSelect('COUNT(*)', 'override_count')
      .addSelect('AVG(o.previous_likelihood - o.new_likelihood)', 'avg_l_delta')
      .addSelect('AVG(o.previous_impact - o.new_impact)', 'avg_i_delta')
      .where('o.organization_id = :orgId', { orgId })
      .groupBy('o.risk_category')
      .having('COUNT(*) >= :minOverrides', {
        minOverrides: DriftReportService.DRIFT_MIN_OVERRIDES,
      })
      .andHaving(
        '(AVG(o.previous_likelihood - o.new_likelihood) > :delta OR AVG(o.previous_impact - o.new_impact) > :delta)',
        { delta: DriftReportService.DRIFT_DELTA_THRESHOLD },
      )
      .getRawMany();

    // Enrich each alert with the CURRENT platform default + learned baseline.
    const alerts: DriftAlert[] = [];
    for (const row of alertRows) {
      // v1: jurisdiction-agnostic platform default. Revisit when
      // contract.jurisdiction propagates to the resolver.
      const pd = await this.platformDefaultRepo
        .createQueryBuilder('pd')
        .where('pd.risk_category = :cat', { cat: row.risk_category })
        .andWhere('pd.jurisdiction_variant IS NULL')
        .getOne();
      const baseline = await this.baselineRepo.findOne({
        where: { organization_id: orgId, risk_category: row.risk_category },
      });
      alerts.push({
        risk_category: row.risk_category,
        override_count: parseInt(row.override_count, 10),
        avg_likelihood_delta: round1(parseFloat(row.avg_l_delta)),
        avg_impact_delta: round1(parseFloat(row.avg_i_delta)),
        platform_default: pd
          ? {
              likelihood: pd.default_likelihood,
              impact: pd.default_impact,
              source: RiskSourceType.PLATFORM_DEFAULT,
            }
          : null,
        learned_baseline: baseline
          ? {
              likelihood: baseline.learned_likelihood,
              impact: baseline.learned_impact,
              override_count: baseline.override_count,
            }
          : undefined,
      });
    }

    // ── fallback_categories (Flag 13): categories with >5 FALLBACK-sourced
    //    findings. Joined via contract→project to scope by org. Signals
    //    which categories the resolver couldn't anchor to any methodology.
    const fallbackCatRows = await this.riskRepo
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .select('r.risk_category', 'risk_category')
      .addSelect('COUNT(*)', 'finding_count')
      .where('p.organization_id = :orgId', { orgId })
      .andWhere('r.likelihood_source = :src', { src: RiskSourceType.FALLBACK })
      .groupBy('r.risk_category')
      .having('COUNT(*) > :minFindings', {
        minFindings: DriftReportService.FALLBACK_MIN_FINDINGS,
      })
      .orderBy('"finding_count"', 'DESC')
      .getRawMany();

    const report: DriftReport = {
      generated_at: new Date(),
      org_summary: {
        total_overrides_30d: thirtyDayCount,
        total_overrides_lifetime: lifetimeCount,
        most_overridden_categories: catRows.map((r) => ({
          risk_category: r.risk_category,
          override_count: parseInt(r.override_count, 10),
          avg_likelihood_delta: round1(parseFloat(r.avg_l_delta)),
          avg_impact_delta: round1(parseFloat(r.avg_i_delta)),
        })),
      },
      drift_alerts: alerts,
      fallback_categories: fallbackCatRows.map((r) => ({
        risk_category: r.risk_category,
        finding_count: parseInt(r.finding_count, 10),
      })),
    };

    this.cache.set(orgId, { value: report, loadedAt: Date.now() });
    return report;
  }

  /**
   * Drop the cached report for this org. Called from B.3's override
   * service after every override so the next read reflects the new data.
   */
  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }
}

// ─── Public types ─────────────────────────────────────────────────────────

export interface OverriddenCategorySummary {
  risk_category: string;
  override_count: number;
  avg_likelihood_delta: number;
  avg_impact_delta: number;
}

export interface DriftAlert {
  risk_category: string;
  override_count: number;
  avg_likelihood_delta: number;
  avg_impact_delta: number;
  platform_default: {
    likelihood: number;
    impact: number;
    source: RiskSourceType;
  } | null;
  learned_baseline?: {
    likelihood: number;
    impact: number;
    override_count: number;
  };
}

export interface FallbackCategory {
  risk_category: string;
  finding_count: number;
}

export interface DriftReport {
  generated_at: Date;
  org_summary: {
    total_overrides_30d: number;
    total_overrides_lifetime: number;
    most_overridden_categories: OverriddenCategorySummary[];
  };
  drift_alerts: DriftAlert[];
  fallback_categories: FallbackCategory[];
}

interface DriftReportCacheEntry {
  value: DriftReport;
  loadedAt: number;
}
