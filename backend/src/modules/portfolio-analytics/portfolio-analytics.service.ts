import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Contract,
  ContractStatus,
  ContractType,
  RiskAnalysis,
  RiskAnalysisStatus,
  RiskLevel,
} from '../../database/entities';
import { mapScoreToRiskLevel } from '../risk-analysis/utils/severity-mapping';
import {
  isStandardForm,
  getLicenseOrg,
} from '../contract-templates/contract-templates.service';
import { AnalyticsPeriod } from '../admin-analytics/dto';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit testing — no DI, no DB)
// ─────────────────────────────────────────────────────────────────────────────

export type ContractStatusBucket =
  | 'DRAFT'
  | 'IN_APPROVAL'
  | 'WITH_COUNTERPARTY'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'TERMINATED';

/**
 * The 12 ContractStatus values folded into the 6 dashboard buckets
 * (Phase 7.17 Prompt 2a, Decision D1). Keyed by every enum value so adding a
 * 13th status is a compile error here — the fold can never silently drop one.
 */
export const CONTRACT_STATUS_BUCKETS: Record<ContractStatus, ContractStatusBucket> = {
  [ContractStatus.DRAFT]: 'DRAFT',
  [ContractStatus.PENDING_APPROVAL]: 'IN_APPROVAL',
  [ContractStatus.APPROVED]: 'IN_APPROVAL',
  [ContractStatus.PENDING_FINAL_APPROVAL]: 'IN_APPROVAL',
  [ContractStatus.CHANGES_REQUESTED]: 'IN_APPROVAL',
  [ContractStatus.RISK_ESCALATION_PENDING]: 'IN_APPROVAL',
  [ContractStatus.PENDING_TENDERING]: 'WITH_COUNTERPARTY',
  [ContractStatus.SENT_TO_CONTRACTOR]: 'WITH_COUNTERPARTY',
  [ContractStatus.CONTRACTOR_REVIEWING]: 'WITH_COUNTERPARTY',
  [ContractStatus.ACTIVE]: 'ACTIVE',
  [ContractStatus.COMPLETED]: 'COMPLETED',
  [ContractStatus.TERMINATED]: 'TERMINATED',
};

export function bucketContractStatus(status: string): ContractStatusBucket {
  return CONTRACT_STATUS_BUCKETS[status as ContractStatus] ?? 'DRAFT';
}

export type StandardFormBucket = 'FIDIC' | 'NEC' | 'OTHER' | 'ADHOC';

/**
 * Fold a contract_type into the FIDIC/NEC/OTHER/ADHOC bucket, reusing the
 * single source of truth (contract-templates.service) rather than a parallel
 * classifier. ADHOC + UPLOADED → ADHOC; everything else → its license org.
 */
export function bucketStandardForm(contractType: string): StandardFormBucket {
  const ct = contractType as ContractType;
  if (!isStandardForm(ct)) return 'ADHOC';
  return getLicenseOrg(ct) as StandardFormBucket; // FIDIC | NEC | OTHER
}

/** Period-over-period percentage change, 1-decimal. Mirrors admin-analytics. */
export function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PortfolioAnalyticsService {
  private readonly logger = new Logger(PortfolioAnalyticsService.name);

  constructor(
    @InjectRepository(Contract) // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(RiskAnalysis) // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
    private readonly riskRepo: Repository<RiskAnalysis>,
  ) {}

  async getPortfolioAnalytics(
    orgId: string,
    period: AnalyticsPeriod,
    projectId?: string,
  ) {
    const safeQuery = async <T>(
      fn: () => Promise<T>,
      fallback: T,
      label: string,
    ): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        this.logger.warn(
          `Portfolio query "${label}" failed for org ${orgId}: ${err.message}`,
        );
        return fallback;
      }
    };

    const range = this.periodRange(period);

    const [
      kpis,
      contractsByStatus,
      valueByCurrency,
      timeToSignature,
      upcomingExpirations,
      projectRisk,
      riskDistribution,
      contractsByStandardForm,
      topProjects,
    ] = await Promise.all([
      safeQuery(() => this.getKpis(orgId, range, projectId), this.emptyKpis(), 'kpis'),
      safeQuery(
        () => this.getContractsByStatus(orgId, projectId),
        { total: 0, buckets: this.emptyStatusBuckets() },
        'contractsByStatus',
      ),
      safeQuery(() => this.getValueByCurrency(orgId, projectId), [], 'valueByCurrency'),
      safeQuery(
        () => this.getTimeToSignature(orgId, range, projectId),
        { avg_days: null, sample_size: 0, excluded_no_shared_at: 0, trend: [] },
        'timeToSignature',
      ),
      safeQuery(
        () => this.getUpcomingExpirations(orgId, projectId),
        { in_30_days: 0, in_60_days: 0, in_90_days: 0, total_within_90: 0 },
        'upcomingExpirations',
      ),
      safeQuery(() => this.getProjectRisk(orgId), [], 'projectRisk'),
      safeQuery(
        () => this.getRiskDistribution(orgId, projectId),
        { total: 0, levels: { LOW: 0, MEDIUM: 0, HIGH: 0 } },
        'riskDistribution',
      ),
      safeQuery(
        () => this.getContractsByStandardForm(orgId, projectId),
        { total: 0, forms: { FIDIC: 0, NEC: 0, OTHER: 0, ADHOC: 0 } },
        'contractsByStandardForm',
      ),
      safeQuery(() => this.getTopProjects(orgId), [], 'topProjects'),
    ]);

    return {
      period,
      project_id: projectId ?? null,
      kpis,
      contracts_by_status: contractsByStatus,
      value_by_currency: valueByCurrency,
      time_to_signature: timeToSignature,
      upcoming_expirations: upcomingExpirations,
      project_risk: projectRisk,
      risk_distribution: riskDistribution,
      contracts_by_standard_form: contractsByStandardForm,
      top_projects: topProjects,
    };
  }

  // ─── Scoping helpers ─────────────────────────────────────────────────────

  /** Contract QB joined to project, scoped to org (+ optional project). */
  private scopedContracts(
    orgId: string,
    projectId?: string,
  ): SelectQueryBuilder<Contract> {
    const qb = this.contractRepo // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId });
    if (projectId) qb.andWhere('p.id = :projectId', { projectId });
    return qb;
  }

  /** RiskAnalysis QB joined risk→contract→project, scoped to org (+ project). */
  private scopedRisks(
    orgId: string,
    projectId?: string,
  ): SelectQueryBuilder<RiskAnalysis> {
    const qb = this.riskRepo // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId });
    if (projectId) qb.andWhere('p.id = :projectId', { projectId });
    return qb;
  }

  private periodRange(period: AnalyticsPeriod) {
    const days =
      period === AnalyticsPeriod.P7
        ? 7
        : period === AnalyticsPeriod.P90
          ? 90
          : period === AnalyticsPeriod.P365
            ? 365
            : 30;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end, prevStart, days };
  }

  // ─── Widgets ─────────────────────────────────────────────────────────────

  private async getKpis(
    orgId: string,
    range: { start: Date; end: Date; prevStart: Date },
    projectId?: string,
  ) {
    const [totalContracts, activeContracts, contractsThis, contractsPrev] =
      await Promise.all([
        this.scopedContracts(orgId, projectId).getCount(),
        this.scopedContracts(orgId, projectId)
          .andWhere('c.status = :active', { active: ContractStatus.ACTIVE })
          .getCount(),
        this.scopedContracts(orgId, projectId)
          .andWhere('c.created_at >= :start AND c.created_at < :end', {
            start: range.start,
            end: range.end,
          })
          .getCount(),
        this.scopedContracts(orgId, projectId)
          .andWhere('c.created_at >= :prevStart AND c.created_at < :start', {
            prevStart: range.prevStart,
            start: range.start,
          })
          .getCount(),
      ]);

    const [openRisks, risksThis, risksPrev] = await Promise.all([
      this.scopedRisks(orgId, projectId)
        .andWhere('r.status = :open', { open: RiskAnalysisStatus.OPEN })
        .getCount(),
      this.scopedRisks(orgId, projectId)
        .andWhere('r.created_at >= :start AND r.created_at < :end', {
          start: range.start,
          end: range.end,
        })
        .getCount(),
      this.scopedRisks(orgId, projectId)
        .andWhere('r.created_at >= :prevStart AND r.created_at < :start', {
          prevStart: range.prevStart,
          start: range.start,
        })
        .getCount(),
    ]);

    return {
      total_contracts: totalContracts,
      active_contracts: activeContracts,
      open_risks: openRisks,
      contracts_created: {
        current: contractsThis,
        previous: contractsPrev,
        delta_pct: pctChange(contractsThis, contractsPrev),
      },
      risks_flagged: {
        current: risksThis,
        previous: risksPrev,
        delta_pct: pctChange(risksThis, risksPrev),
      },
    };
  }

  private async getContractsByStatus(orgId: string, projectId?: string) {
    const rows = await this.scopedContracts(orgId, projectId)
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string }>();

    const buckets = this.emptyStatusBuckets();
    let total = 0;
    rows.forEach((r) => {
      const n = parseInt(r.count, 10);
      total += n;
      buckets[bucketContractStatus(r.status)] += n;
    });
    return { total, buckets };
  }

  private async getValueByCurrency(orgId: string, projectId?: string) {
    const rows = await this.scopedContracts(orgId, projectId)
      .select('c.currency', 'currency')
      .addSelect('SUM(c.contract_value)', 'total')
      .addSelect('COUNT(*)', 'count')
      .andWhere('c.contract_value IS NOT NULL')
      .andWhere('c.currency IS NOT NULL')
      .groupBy('c.currency')
      .orderBy('total', 'DESC')
      .getRawMany<{ currency: string; total: string; count: string }>();

    // No cross-currency total — FX conversion is explicitly out of scope (v1).
    return rows.map((r) => ({
      currency: r.currency,
      total: parseFloat(r.total) || 0,
      count: parseInt(r.count, 10),
    }));
  }

  private async getTimeToSignature(
    orgId: string,
    range: { start: Date },
    projectId?: string,
  ) {
    // Anchor = shared_at → executed_at (review→signed interval, NOT created_at;
    // see Decision D2). Both must be non-null — but contracts that reached
    // executed_at WITHOUT a shared_at are NOT silently dropped: they are
    // counted into `excluded_no_shared_at` so the denominator is auditable
    // (a non-zero value means the avg is computed over a subset of signed
    // contracts, which a consumer must be able to see).
    const DIFF_DAYS =
      'EXTRACT(EPOCH FROM (c.executed_at - c.shared_at)) / 86400.0';

    const [avgRow, excludedRow] = await Promise.all([
      this.scopedContracts(orgId, projectId)
        .select(`AVG(${DIFF_DAYS})`, 'days')
        .addSelect('COUNT(*)', 'count')
        .andWhere('c.executed_at IS NOT NULL')
        .andWhere('c.shared_at IS NOT NULL')
        .getRawOne<{ days: string | null; count: string }>(),
      this.scopedContracts(orgId, projectId)
        .select('COUNT(*)', 'count')
        .andWhere('c.executed_at IS NOT NULL')
        .andWhere('c.shared_at IS NULL')
        .getRawOne<{ count: string }>(),
    ]);

    const excludedNoSharedAt = excludedRow?.count
      ? parseInt(excludedRow.count, 10)
      : 0;
    if (excludedNoSharedAt > 0) {
      this.logger.warn(
        `time-to-signature: ${excludedNoSharedAt} signed contract(s) for org ${orgId} have executed_at but no shared_at — excluded from the average.`,
      );
    }

    const trendRows = await this.scopedContracts(orgId, projectId)
      .select("TO_CHAR(c.executed_at, 'YYYY-MM')", 'month')
      .addSelect(`AVG(${DIFF_DAYS})`, 'avg_days')
      .addSelect('COUNT(*)', 'count')
      .andWhere('c.executed_at IS NOT NULL')
      .andWhere('c.shared_at IS NOT NULL')
      .andWhere('c.executed_at >= :start', { start: range.start })
      .groupBy("TO_CHAR(c.executed_at, 'YYYY-MM')")
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; avg_days: string | null; count: string }>();

    const round1 = (v: string | null) =>
      v != null ? Math.round(parseFloat(v) * 10) / 10 : null;

    return {
      avg_days: round1(avgRow?.days ?? null),
      sample_size: avgRow?.count ? parseInt(avgRow.count, 10) : 0,
      excluded_no_shared_at: excludedNoSharedAt,
      trend: trendRows.map((t) => ({
        month: t.month,
        avg_days: round1(t.avg_days),
        count: parseInt(t.count, 10),
      })),
    };
  }

  private async getUpcomingExpirations(orgId: string, projectId?: string) {
    const now = new Date();
    const iso = (n: number) =>
      new Date(now.getTime() + n * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const nowIso = now.toISOString().slice(0, 10);

    const bucketCount = (gtParam: string, lteParam: string, params: object) =>
      this.scopedContracts(orgId, projectId)
        .andWhere('c.expiry_date IS NOT NULL')
        .andWhere(`c.expiry_date > :${gtParam} AND c.expiry_date <= :${lteParam}`, params)
        .getCount();

    const [in30, in60, in90] = await Promise.all([
      bucketCount('now', 'd30', { now: nowIso, d30: iso(30) }),
      bucketCount('d30', 'd60', { d30: iso(30), d60: iso(60) }),
      bucketCount('d60', 'd90', { d60: iso(60), d90: iso(90) }),
    ]);

    return {
      in_30_days: in30,
      in_60_days: in60,
      in_90_days: in90,
      total_within_90: in30 + in60 + in90,
    };
  }

  /**
   * Per-project worst-finding risk (PMBOK 5×5 worst-finding rule):
   * MAX(risk_score) GROUP BY project, org-wide (NOT project-scoped) — the bar
   * chart across all projects.
   *
   * INDEX / STAGING NOTE (Phase 7.17 Prompt 2a, Addition 1 — INCONCLUSIVE on dev):
   * The dev EXPLAIN ANALYZE ran against 0 risk_analyses rows, so the planner's
   * index-vs-seqscan choice there is a degenerate tie-break — it does NOT verify
   * the MAX(risk_score) aggregation / heap-fetch cost this query was scrutinised
   * for (it only exercised the contract_id join path, which the empty plan
   * happened to index-scan). Decision: NO new index — but as a *default*, not
   * "verified": risk_analyses is write-hot while this is an infrequent
   * OWNER_ADMIN read, so a covering index trades guaranteed write-amplification
   * for a speculative read win. The existing IDX_risk_analyses_contract serves
   * the join. MANDATORY: re-run EXPLAIN ANALYZE against representative staging
   * row counts; the known fix — IFF MAX heap fetches dominate there — is a
   * covering index `(contract_id) INCLUDE (risk_score)`. See lesson #134.
   */
  private async getProjectRisk(orgId: string) {
    const rows = await this.riskRepo // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .select('p.id', 'project_id')
      .addSelect('p.name', 'project_name')
      .addSelect('MAX(r.risk_score)', 'worst_score')
      .addSelect('COUNT(*)', 'finding_count')
      .where('p.organization_id = :orgId', { orgId })
      .groupBy('p.id')
      .addGroupBy('p.name')
      .orderBy('worst_score', 'DESC')
      .getRawMany<{
        project_id: string;
        project_name: string;
        worst_score: string;
        finding_count: string;
      }>();

    return rows.map((r) => {
      const score = parseInt(r.worst_score, 10);
      return {
        project_id: r.project_id,
        project_name: r.project_name,
        worst_score: score,
        level: mapScoreToRiskLevel(score),
        finding_count: parseInt(r.finding_count, 10),
      };
    });
  }

  private async getRiskDistribution(orgId: string, projectId?: string) {
    const rows = await this.scopedRisks(orgId, projectId)
      .select('r.risk_score', 'score')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.risk_score')
      .getRawMany<{ score: string; count: string }>();

    const levels: Record<RiskLevel, number> = {
      [RiskLevel.LOW]: 0,
      [RiskLevel.MEDIUM]: 0,
      [RiskLevel.HIGH]: 0,
    };
    let total = 0;
    rows.forEach((r) => {
      const n = parseInt(r.count, 10);
      total += n;
      levels[mapScoreToRiskLevel(parseInt(r.score, 10))] += n;
    });
    return { total, levels };
  }

  private async getContractsByStandardForm(orgId: string, projectId?: string) {
    const rows = await this.scopedContracts(orgId, projectId)
      .select('c.contract_type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.contract_type')
      .getRawMany<{ type: string; count: string }>();

    const forms: Record<StandardFormBucket, number> = {
      FIDIC: 0,
      NEC: 0,
      OTHER: 0,
      ADHOC: 0,
    };
    let total = 0;
    rows.forEach((r) => {
      const n = parseInt(r.count, 10);
      total += n;
      forms[bucketStandardForm(r.type)] += n;
    });
    return { total, forms };
  }

  /**
   * Top projects by contract count, with worst-risk level grafted on.
   * Monetary value is intentionally omitted here — summing across currencies
   * would violate the no-FX rule (v1). Per-currency value lives in its own widget.
   */
  private async getTopProjects(orgId: string) {
    const contractRows = await this.contractRepo // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('c')
      .innerJoin('c.project', 'p')
      .select('p.id', 'project_id')
      .addSelect('p.name', 'project_name')
      .addSelect('COUNT(*)', 'contract_count')
      .addSelect(
        'SUM(CASE WHEN c.status = :active THEN 1 ELSE 0 END)',
        'active_count',
      )
      .where('p.organization_id = :orgId', { orgId })
      .setParameter('active', ContractStatus.ACTIVE)
      .groupBy('p.id')
      .addGroupBy('p.name')
      .orderBy('contract_count', 'DESC')
      .limit(10)
      .getRawMany<{
        project_id: string;
        project_name: string;
        contract_count: string;
        active_count: string;
      }>();

    const riskRows = await this.riskRepo // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .select('p.id', 'project_id')
      .addSelect('MAX(r.risk_score)', 'worst_score')
      .where('p.organization_id = :orgId', { orgId })
      .groupBy('p.id')
      .getRawMany<{ project_id: string; worst_score: string }>();

    const worstByProject = new Map(
      riskRows.map((r) => [r.project_id, parseInt(r.worst_score, 10)]),
    );

    return contractRows.map((r) => {
      const worst = worstByProject.get(r.project_id) ?? null;
      return {
        project_id: r.project_id,
        project_name: r.project_name,
        contract_count: parseInt(r.contract_count, 10),
        active_count: parseInt(r.active_count, 10),
        worst_score: worst,
        worst_level: worst != null ? mapScoreToRiskLevel(worst) : null,
      };
    });
  }

  // ─── Empty-shape factories (fallbacks for safeQuery) ──────────────────────

  private emptyStatusBuckets(): Record<ContractStatusBucket, number> {
    return {
      DRAFT: 0,
      IN_APPROVAL: 0,
      WITH_COUNTERPARTY: 0,
      ACTIVE: 0,
      COMPLETED: 0,
      TERMINATED: 0,
    };
  }

  private emptyKpis() {
    const zeroDelta = { current: 0, previous: 0, delta_pct: 0 };
    return {
      total_contracts: 0,
      active_contracts: 0,
      open_risks: 0,
      contracts_created: zeroDelta,
      risks_flagged: zeroDelta,
    };
  }
}
