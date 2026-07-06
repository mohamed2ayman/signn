import {
  computeProjectHealth,
  HEALTH_WEIGHTS,
  type ProjectHealthInput,
} from './projectHealth';
import type { ProjectDashboard } from '@/services/api/projectService';

// ─────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * Dashboard fixture. NOTE: `count` fields are intentionally STRINGS —
 * the real endpoint returns raw PG COUNT(*) via getRawMany() (landmine 1),
 * and the breakdown arrays are SPARSE (landmine 2): only levels/statuses
 * with count >= 1 appear at all.
 */
function dashboard(overrides: Partial<ProjectDashboard> = {}): ProjectDashboard {
  return {
    project_id: 'p-1',
    contracts: { total: 10, by_status: [] },
    parties: { total: 0, by_type: [] },
    risk_summary: [{ risk_level: 'LOW', count: '5' }],
    ...overrides,
  };
}

function input(overrides: Partial<ProjectHealthInput> = {}): ProjectHealthInput {
  return {
    dashboard: dashboard(),
    contracts: [],
    obligations: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Insufficient-data guard
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — insufficient data', () => {
  it('returns insufficient when the project has 0 contracts', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({ contracts: { total: 0, by_status: [] } }),
      }),
    );
    expect(r.sufficient).toBe(false);
  });

  it('returns insufficient when no contract has been risk-analysed (empty risk_summary)', () => {
    const r = computeProjectHealth(input({ dashboard: dashboard({ risk_summary: [] }) }));
    expect(r.sufficient).toBe(false);
  });

  it('never reports a score/band on the insufficient branch', () => {
    const r = computeProjectHealth(
      input({ dashboard: dashboard({ contracts: { total: 0, by_status: [] } }) }),
    );
    expect('score' in r).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Bands
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — bands', () => {
  it('all-clear project scores 100 / healthy', () => {
    const r = computeProjectHealth(input());
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(100);
    expect(r.band).toBe('healthy');
    expect(r.drivers).toEqual([]);
  });

  it('a moderate risk mix lands in the atRisk band (55-79)', () => {
    // 10 contracts, 4 HIGH findings → 4/10×45 = 18; 5 MEDIUM → 5/10×18 = 9;
    // 2 overdue obligations → 8. Score = 100 − 18 − 9 − 8 = 65.
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          risk_summary: [
            { risk_level: 'HIGH', count: '4' },
            { risk_level: 'MEDIUM', count: '5' },
          ],
        }),
        obligations: [
          { status: 'PENDING', due_date: isoDaysFromNow(-3) },
          { status: 'IN_PROGRESS', due_date: isoDaysFromNow(-10) },
        ],
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(65);
    expect(r.band).toBe('atRisk');
  });

  it('heavy risk + overdue load lands critical (<55) and caps each bucket', () => {
    // 2 contracts, 20 HIGH findings → uncapped 450, capped at RISK_CAP (45).
    // 10 overdue obligations → uncapped 40, capped at OVERDUE_CAP (20).
    // Both contracts expired → 25 (status bucket, under its cap).
    // Score = 100 − 45 − 25 − 20 = 10.
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          contracts: { total: 2, by_status: [] },
          risk_summary: [{ risk_level: 'HIGH', count: '20' }],
        }),
        contracts: [
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(-40) },
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(-5) },
        ],
        obligations: Array.from({ length: 10 }, () => ({
          status: 'PENDING' as const,
          due_date: isoDaysFromNow(-2),
        })),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(10);
    expect(r.band).toBe('critical');
  });

  it('score is clamped to [0, 100]', () => {
    // Max out all three buckets: 45 + 30 + 20 = 95 → still >= 0; verify no
    // negative leak by pushing every deduction to its cap.
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          contracts: {
            total: 1,
            by_status: [
              { status: 'DRAFT', count: '1' },
              { status: 'CHANGES_REQUESTED', count: '1' },
            ],
          },
          risk_summary: [{ risk_level: 'HIGH', count: '50' }],
        }),
        contracts: [{ status: 'DRAFT', expiry_date: isoDaysFromNow(-1) }],
        obligations: Array.from({ length: 20 }, () => ({
          status: 'PENDING' as const,
          due_date: isoDaysFromNow(-1),
        })),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBe(100 - HEALTH_WEIGHTS.RISK_CAP - HEALTH_WEIGHTS.STATUS_CAP - HEALTH_WEIGHTS.OVERDUE_CAP);
  });
});

// ─────────────────────────────────────────────────────────────────
// The three landmines
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — endpoint shape landmines', () => {
  it('landmine 1: string counts are converted with Number(), never concatenated/NaN', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          risk_summary: [{ risk_level: 'HIGH', count: '2' }], // string on the wire
        }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // 2/10 × 45 = 9 → 100 − 9 = 91. NaN math would make score NaN.
    expect(r.score).toBe(91);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('landmine 2: sparse arrays — a missing HIGH row means 0 HIGH, not NaN/undefined', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          // Only MEDIUM present; HIGH and LOW rows absent entirely.
          risk_summary: [{ risk_level: 'MEDIUM', count: '5' }],
        }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // 5/10 × 18 = 9 → 91. A NaN HIGH term would poison the whole score.
    expect(r.score).toBe(91);
  });

  it('sparse by_status — missing DRAFT/CHANGES_REQUESTED rows deduct nothing', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          contracts: { total: 10, by_status: [{ status: 'ACTIVE', count: '10' }] },
        }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────
// Contract-status deductions
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — contract status inputs', () => {
  it('counts expired vs expiring-within-30d contracts separately', () => {
    // 10 contracts: 1 expired → 1/10×25 = 2.5; 2 expiring in 30d → 2/10×12 = 2.4.
    // Score = round(100 − 4.9) = 95.
    const r = computeProjectHealth(
      input({
        contracts: [
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(-2) },
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(10) },
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(29) },
          { status: 'ACTIVE', expiry_date: isoDaysFromNow(90) }, // not expiring soon
          { status: 'ACTIVE', expiry_date: null }, // no expiry — ignored
        ],
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(95);
  });

  it('stalled drafts come from by_status DRAFT + CHANGES_REQUESTED', () => {
    // 3 stalled / 10 × 8 = 2.4 → round(97.6) = 98.
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          contracts: {
            total: 10,
            by_status: [
              { status: 'DRAFT', count: '2' },
              { status: 'CHANGES_REQUESTED', count: '1' },
              { status: 'ACTIVE', count: '7' },
            ],
          },
        }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(98);
  });
});

// ─────────────────────────────────────────────────────────────────
// Overdue obligations (effectiveStatus semantics)
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — overdue obligations', () => {
  it('uses effectiveStatus: past-due PENDING counts, future PENDING and past-due MET do not', () => {
    const r = computeProjectHealth(
      input({
        obligations: [
          { status: 'PENDING', due_date: isoDaysFromNow(-1) }, // overdue (derived)
          { status: 'OVERDUE', due_date: isoDaysFromNow(-9) }, // overdue (stored)
          { status: 'PENDING', due_date: isoDaysFromNow(5) }, // fine
          { status: 'MET', due_date: isoDaysFromNow(-30) }, // actioned — not overdue
        ],
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // 2 overdue × 4 = 8 → 92.
    expect(r.score).toBe(92);
  });
});

// ─────────────────────────────────────────────────────────────────
// Drivers
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — drivers', () => {
  it('returns the largest deductions first, at most 3, whole-percent points', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({
          contracts: {
            total: 10,
            by_status: [{ status: 'DRAFT', count: '1' }], // 0.8 → rounds to 1
          },
          risk_summary: [
            { risk_level: 'HIGH', count: '2' }, // 9
            { risk_level: 'MEDIUM', count: '2' }, // 3.6 → 4
          ],
        }),
        contracts: [{ status: 'ACTIVE', expiry_date: isoDaysFromNow(15) }], // expiring: 1.2 → 1
        obligations: [{ status: 'PENDING', due_date: isoDaysFromNow(-1) }], // 4
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.drivers.length).toBe(3);
    expect(r.drivers[0].key).toBe('highRisk');
    expect(r.drivers[0].points).toBe(9);
    expect(r.drivers[0].count).toBe(2);
    // All points are whole numbers.
    for (const d of r.drivers) {
      expect(Number.isInteger(d.points)).toBe(true);
      expect(d.points).toBeGreaterThanOrEqual(1);
    }
    // Sorted descending.
    const pts = r.drivers.map((d) => d.points);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
  });

  it('omits drivers whose deduction rounds below 1 point', () => {
    const r = computeProjectHealth(input()); // all-clear
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.drivers).toEqual([]);
  });
});
