import {
  PROJECT_CONTRACT_STATUS_BUCKETS,
  foldContractStatuses,
  riskMixFromSummary,
  deriveUpcomingObligations,
} from './dashboardAnalytics';
import type { ProjectDashboard } from '@/services/api/projectService';

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

// ─────────────────────────────────────────────────────────────────
// The 12→6 fold — MIRRORS backend CONTRACT_STATUS_BUCKETS
// (portfolio-analytics.service.ts). Every status asserted individually so
// a drift from the backend map fails a named test, not a vague total.
// ─────────────────────────────────────────────────────────────────

describe('foldContractStatuses — 12→6 bucket fold', () => {
  const EXPECTED: Record<string, string> = {
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

  it.each(Object.entries(EXPECTED))('maps %s → %s (backend parity)', (raw, bucket) => {
    expect(PROJECT_CONTRACT_STATUS_BUCKETS[raw]).toBe(bucket);
  });

  it('covers exactly the 12 ContractStatus values', () => {
    expect(Object.keys(PROJECT_CONTRACT_STATUS_BUCKETS)).toHaveLength(12);
  });

  it('folds all 12 statuses at count 1 into the right bucket sums', () => {
    const rows = Object.keys(EXPECTED).map((status) => ({ status, count: '1' }));
    const out = foldContractStatuses(rows);
    expect(out.total).toBe(12);
    expect(out.buckets).toEqual({
      DRAFT: 1,
      IN_APPROVAL: 5,
      WITH_COUNTERPARTY: 3,
      ACTIVE: 1,
      COMPLETED: 1,
      TERMINATED: 1,
    });
  });

  it('landmine: string counts go through Number()', () => {
    const out = foldContractStatuses([{ status: 'ACTIVE', count: '6' }]);
    expect(out.buckets.ACTIVE).toBe(6);
    expect(out.total).toBe(6);
    expect(Number.isFinite(out.total)).toBe(true);
  });

  it('landmine: sparse input — missing statuses read 0, all 6 buckets always present', () => {
    const out = foldContractStatuses([{ status: 'DRAFT', count: '2' }]);
    expect(out.buckets).toEqual({
      DRAFT: 2,
      IN_APPROVAL: 0,
      WITH_COUNTERPARTY: 0,
      ACTIVE: 0,
      COMPLETED: 0,
      TERMINATED: 0,
    });
  });

  it('unknown status falls back to DRAFT (backend bucketContractStatus parity)', () => {
    const out = foldContractStatuses([{ status: 'SOME_FUTURE_STATUS', count: '3' }]);
    expect(out.buckets.DRAFT).toBe(3);
  });

  it('empty input → all-zero buckets, total 0', () => {
    const out = foldContractStatuses([]);
    expect(out.total).toBe(0);
    expect(Object.values(out.buckets).every((v) => v === 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Risk mix adapter — sparse + string counts (lesson #210)
// ─────────────────────────────────────────────────────────────────

describe('riskMixFromSummary', () => {
  const dash = (risk_summary: ProjectDashboard['risk_summary']): ProjectDashboard => ({
    project_id: 'p-1',
    contracts: { total: 5, by_status: [] },
    parties: { total: 0, by_type: [] },
    risk_summary,
  });

  it('sparse: no HIGH row → HIGH 0, never undefined/NaN', () => {
    const out = riskMixFromSummary(dash([{ risk_level: 'LOW', count: '3' }]));
    expect(out.levels).toEqual({ LOW: 3, MEDIUM: 0, HIGH: 0 });
    expect(out.total).toBe(3);
  });

  it('string counts → Number()', () => {
    const out = riskMixFromSummary(
      dash([
        { risk_level: 'HIGH', count: '4' },
        { risk_level: 'MEDIUM', count: '4' },
        { risk_level: 'LOW', count: '2' },
      ]),
    );
    expect(out.levels).toEqual({ LOW: 2, MEDIUM: 4, HIGH: 4 });
    expect(out.total).toBe(10);
  });

  it('empty summary → total 0 (drives the WidgetEmpty state)', () => {
    expect(riskMixFromSummary(dash([])).total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Upcoming obligations (widget B's short list)
// ─────────────────────────────────────────────────────────────────

describe('deriveUpcomingObligations', () => {
  const o = (status: string, dueOffsetDays: number | null, id: string) =>
    ({
      id,
      status,
      due_date: dueOffsetDays === null ? null : isoDaysFromNow(dueOffsetDays),
      description: id,
    }) as never;

  it('returns only open future-dated obligations, soonest first, capped', () => {
    const out = deriveUpcomingObligations(
      [
        o('PENDING', 20, 'far'),
        o('PENDING', 3, 'soon'),
        o('IN_PROGRESS', 8, 'mid'),
        o('PENDING', -2, 'overdue-not-upcoming'),
        o('MET', 5, 'actioned-not-upcoming'),
        o('PENDING', null, 'no-date'),
        o('PENDING', 40, 'capped-out'),
      ],
      3,
    );
    expect(out.map((x) => x.id)).toEqual(['soon', 'mid', 'far']);
  });
});
