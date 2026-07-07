/**
 * Supporting-analytics derivations — 7.20 slice 3.
 *
 * PURE functions adapting `GET /projects/:id/dashboard`'s raw shapes into
 * the existing portfolio widget inputs. All lesson-#210 landmines handled
 * here: string counts → Number(), sparse arrays → zero-filled records.
 */
import { effectiveStatus, daysUntil } from '@/components/obligations/statusUtils';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import type { ProjectDashboard } from '@/services/api/projectService';
import type {
  ContractStatusBucket,
  ContractsByStatus,
  RiskDistribution,
} from '@/services/api/portfolioService';

/**
 * The 12 ContractStatus values folded into the 6 dashboard buckets.
 *
 * ⚠️ MIRROR — the SOURCE OF TRUTH is the backend `CONTRACT_STATUS_BUCKETS`
 * in `backend/src/modules/portfolio-analytics/portfolio-analytics.service.ts`
 * (Phase 7.17 Prompt 2a, Decision D1). It cannot be imported here: `backend/`
 * is an independent package outside the npm workspace and the constant lives
 * inside a Nest service importing backend entities. Any change to the backend
 * map MUST be replicated here in the same PR — the per-status parity tests in
 * `dashboardAnalytics.test.ts` name each mapping so drift fails loudly.
 */
export const PROJECT_CONTRACT_STATUS_BUCKETS: Record<string, ContractStatusBucket> = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'IN_APPROVAL',
  APPROVED: 'IN_APPROVAL',
  PENDING_FINAL_APPROVAL: 'IN_APPROVAL',
  CHANGES_REQUESTED: 'IN_APPROVAL',
  RISK_ESCALATION_PENDING: 'IN_APPROVAL',
  PENDING_TENDERING: 'WITH_COUNTERPARTY',
  SENT_TO_CONTRACTOR: 'WITH_COUNTERPARTY',
  CONTRACTOR_REVIEWING: 'WITH_COUNTERPARTY',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  TERMINATED: 'TERMINATED',
};

const EMPTY_BUCKETS = (): Record<ContractStatusBucket, number> => ({
  DRAFT: 0,
  IN_APPROVAL: 0,
  WITH_COUNTERPARTY: 0,
  ACTIVE: 0,
  COMPLETED: 0,
  TERMINATED: 0,
});

/**
 * Fold the raw sparse string-count `by_status` array into StatusPie's
 * 6-bucket shape. Unknown statuses fall back to DRAFT — parity with the
 * backend's `bucketContractStatus()`.
 */
export function foldContractStatuses(
  byStatus: ReadonlyArray<{ status: string; count: string }>,
): ContractsByStatus {
  const buckets = EMPTY_BUCKETS();
  let total = 0;
  for (const row of byStatus) {
    const n = Number(row.count) || 0; // landmine 1: string counts
    const bucket = PROJECT_CONTRACT_STATUS_BUCKETS[row.status] ?? 'DRAFT';
    buckets[bucket] += n;
    total += n;
  }
  return { total, buckets }; // landmine 2: all 6 buckets always present
}

/** Adapt the sparse string-count risk_summary into RiskDistributionBar's shape. */
export function riskMixFromSummary(dashboard: ProjectDashboard): RiskDistribution {
  const levels: RiskDistribution['levels'] = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const row of dashboard.risk_summary) {
    if (row.risk_level in levels) {
      levels[row.risk_level as keyof typeof levels] = Number(row.count) || 0;
    }
  }
  return { total: levels.LOW + levels.MEDIUM + levels.HIGH, levels };
}

/**
 * The obligation rollup's short "next due" list: OPEN obligations
 * (effective PENDING/IN_PROGRESS — actioned and overdue excluded; overdue
 * lives in the attention zone) with a future due date, soonest first.
 */
export function deriveUpcomingObligations(
  obligations: ObligationPortfolioItem[],
  limit = 3,
): ObligationPortfolioItem[] {
  return obligations
    .filter((o) => {
      const eff = effectiveStatus(o.status, o.due_date);
      if (eff !== 'PENDING' && eff !== 'IN_PROGRESS') return false;
      const days = daysUntil(o.due_date);
      return days !== null && days >= 0;
    })
    .sort((a, b) => (daysUntil(a.due_date) ?? 0) - (daysUntil(b.due_date) ?? 0))
    .slice(0, limit);
}
