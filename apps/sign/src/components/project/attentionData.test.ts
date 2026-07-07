import {
  deriveOverdueObligations,
  deriveContractExpiry,
  deriveHighRiskCount,
} from './attentionData';
import type { ProjectDashboard } from '@/services/api/projectService';

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

/** Date-only string (YYYY-MM-DD), the wire format of contracts.expiry_date. */
const dateDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────
// deriveOverdueObligations — the primary correctness risk: overdue is
// DERIVED via effectiveStatus, never a bare status === 'OVERDUE' filter
// ─────────────────────────────────────────────────────────────────

describe('deriveOverdueObligations', () => {
  const o = (status: string, dueOffsetDays: number | null, id = 'o') =>
    ({
      id: `${id}-${status}-${dueOffsetDays}`,
      status,
      due_date: dueOffsetDays === null ? null : isoDaysFromNow(dueOffsetDays),
      description: 'x',
    }) as never;

  it('counts a PENDING obligation with a past due_date as overdue (derived)', () => {
    const out = deriveOverdueObligations([o('PENDING', -3)]);
    expect(out).toHaveLength(1);
  });

  it('counts IN_PROGRESS past-due and stored OVERDUE rows', () => {
    const out = deriveOverdueObligations([o('IN_PROGRESS', -10), o('OVERDUE', -20)]);
    expect(out).toHaveLength(2);
  });

  it('does NOT count COMPLETED or MET obligations even with past due dates', () => {
    const out = deriveOverdueObligations([o('COMPLETED', -30), o('MET', -30), o('WAIVED', -30)]);
    expect(out).toHaveLength(0);
  });

  it('does NOT count future PENDING or null-due-date obligations', () => {
    const out = deriveOverdueObligations([o('PENDING', 5), o('PENDING', null)]);
    expect(out).toHaveLength(0);
  });

  it('sorts most-overdue first', () => {
    const out = deriveOverdueObligations([o('PENDING', -2, 'a'), o('PENDING', -40, 'b'), o('OVERDUE', -10, 'c')]);
    expect(out.map((x) => x.id)).toEqual([
      'b-PENDING--40',
      'c-OVERDUE--10',
      'a-PENDING--2',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────
// deriveContractExpiry — 30-day window boundaries
// ─────────────────────────────────────────────────────────────────

describe('deriveContractExpiry', () => {
  const c = (expiryOffsetDays: number | null, id = 'c') =>
    ({
      id: `${id}-${expiryOffsetDays}`,
      name: 'QA contract',
      expiry_date: expiryOffsetDays === null ? null : dateDaysFromNow(expiryOffsetDays),
    }) as never;

  it('due today → expiring (in)', () => {
    const { expiring, expired } = deriveContractExpiry([c(0)]);
    expect(expiring).toHaveLength(1);
    expect(expired).toHaveLength(0);
  });

  it('30 days out → expiring (in)', () => {
    const { expiring } = deriveContractExpiry([c(30)]);
    expect(expiring).toHaveLength(1);
  });

  it('31 days out → NOT expiring (out)', () => {
    const { expiring, expired } = deriveContractExpiry([c(31)]);
    expect(expiring).toHaveLength(0);
    expect(expired).toHaveLength(0);
  });

  it('already past → expired, never "expiring"', () => {
    const { expiring, expired } = deriveContractExpiry([c(-2)]);
    expect(expiring).toHaveLength(0);
    expect(expired).toHaveLength(1);
  });

  it('null expiry_date → neither', () => {
    const { expiring, expired } = deriveContractExpiry([c(null)]);
    expect(expiring).toHaveLength(0);
    expect(expired).toHaveLength(0);
  });

  it('expiring sorted soonest-first', () => {
    const { expiring } = deriveContractExpiry([c(20, 'a'), c(3, 'b'), c(29, 'x')]);
    expect(expiring.map((r) => r.contract.id)).toEqual(['b-3', 'a-20', 'x-29']);
  });

  it('each entry carries daysLeft for tone rendering', () => {
    const { expiring } = deriveContractExpiry([c(7)]);
    expect(expiring[0].daysLeft).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────
// deriveHighRiskCount — sparse risk_summary + string counts (lesson #210)
// ─────────────────────────────────────────────────────────────────

describe('deriveHighRiskCount', () => {
  const dash = (risk_summary: ProjectDashboard['risk_summary']): ProjectDashboard => ({
    project_id: 'p-1',
    contracts: { total: 5, by_status: [] },
    parties: { total: 0, by_type: [] },
    risk_summary,
  });

  it('sparse array with no HIGH row → 0 (not undefined/NaN)', () => {
    const n = deriveHighRiskCount(dash([{ risk_level: 'LOW', count: '3' }]));
    expect(n).toBe(0);
    expect(Number.isFinite(n)).toBe(true);
  });

  it('string count is converted with Number()', () => {
    expect(deriveHighRiskCount(dash([{ risk_level: 'HIGH', count: '4' }]))).toBe(4);
  });

  it('empty risk_summary → 0', () => {
    expect(deriveHighRiskCount(dash([]))).toBe(0);
  });
});
