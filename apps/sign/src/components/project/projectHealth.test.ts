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

/** A single-contract project (the real data shape) with N HIGH + M MEDIUM
 *  findings and its one contract DRAFT (stalled). Mirrors the 15 live
 *  projects that were all stuck at 47%. */
function singleContract(high: number, medium: number, stalled = true): ProjectHealthInput {
  return input({
    dashboard: dashboard({
      contracts: {
        total: 1,
        by_status: stalled ? [{ status: 'DRAFT', count: '1' }] : [],
      },
      risk_summary: [
        { risk_level: 'HIGH', count: String(high) },
        { risk_level: 'MEDIUM', count: String(medium) },
      ],
    }),
  });
}

const scoreOf = (r: ReturnType<typeof computeProjectHealth>) =>
  r.sufficient ? r.score : NaN;

// ─────────────────────────────────────────────────────────────────
// Insufficient-data guard
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — insufficient data', () => {
  it('returns insufficient when the project has 0 contracts', () => {
    const r = computeProjectHealth(
      input({ dashboard: dashboard({ contracts: { total: 0, by_status: [] } }) }),
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
// Bands / real-shaped inputs
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

  it('a heavily-analysed single contract (17 HIGH / 139 MEDIUM, DRAFT) is critical — 51%, not the old stuck 47%', () => {
    const r = computeProjectHealth(singleContract(17, 139)); // Muhlbauer shape
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // riskDeduction ≈ 41.4 (saturating, < 45 cap) + stalled 8 → 100 − 49.4 ≈ 51.
    expect(r.score).toBe(51);
    expect(r.band).toBe('critical');
  });

  it('a lighter single contract (5 HIGH / 48 MEDIUM, DRAFT) lands atRisk — 66%', () => {
    const r = computeProjectHealth(singleContract(5, 48)); // Project14 shape
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBe(66);
    expect(r.band).toBe('atRisk');
  });
});

// ─────────────────────────────────────────────────────────────────
// Saturating risk curve (Issue 2, Option A)
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — saturating risk curve', () => {
  it('risk deduction is bounded: even 10000 findings on one contract cannot push the risk floor below 55%', () => {
    // Risk alone: score = 100 − riskDeduction, and riskDeduction < RISK_MAX (45),
    // so a risk-only project can never score below 100 − 45 = 55.
    const r = computeProjectHealth(singleContract(10_000, 10_000, false));
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.score).toBeGreaterThanOrEqual(100 - HEALTH_WEIGHTS.RISK_MAX_DEDUCTION);
  });

  it('is monotonic: more findings → a strictly lower score', () => {
    const fewer = computeProjectHealth(singleContract(0, 40, false));
    const more = computeProjectHealth(singleContract(0, 140, false));
    expect(scoreOf(more)).toBeLessThan(scoreOf(fewer));
  });

  it('produces a SPREAD across differing inputs (regression: no longer stuck at one value)', () => {
    const heavy = computeProjectHealth(singleContract(17, 139)); // 51
    const light = computeProjectHealth(singleContract(3, 42)); // 70
    expect(scoreOf(heavy)).not.toBe(scoreOf(light));
    expect(scoreOf(heavy)).toBeLessThan(scoreOf(light));
  });

  it('diminishing returns: HIGH weighted above MEDIUM (same count of HIGH hurts more)', () => {
    const highHeavy = computeProjectHealth(singleContract(50, 0, false));
    const medHeavy = computeProjectHealth(singleContract(0, 50, false));
    expect(scoreOf(highHeavy)).toBeLessThan(scoreOf(medHeavy));
  });
});

// ─────────────────────────────────────────────────────────────────
// Endpoint shape landmines
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — endpoint shape landmines', () => {
  it('landmine 1: string counts are converted with Number(), never concatenated/NaN', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({ risk_summary: [{ risk_level: 'HIGH', count: '40' }] }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // load = 40·2.5 / 10 = 10 → riskDeduction ≈ 5.84 → 94. NaN math would poison it.
    expect(r.score).toBe(94);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('landmine 2: sparse arrays — a missing HIGH row means 0 HIGH, not NaN/undefined', () => {
    const r = computeProjectHealth(
      input({
        dashboard: dashboard({ risk_summary: [{ risk_level: 'MEDIUM', count: '50' }] }),
      }),
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    // load = 50·1 / 10 = 5 → riskDeduction ≈ 3.02 → 97. A NaN HIGH term would poison it.
    expect(r.score).toBe(97);
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
    expect(r.score).toBe(100); // LOW-only risk → riskDeduction 0
  });
});

// ─────────────────────────────────────────────────────────────────
// Contract-status deductions (unchanged term — LOW-only risk keeps it isolated)
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — contract status inputs', () => {
  it('counts expired vs expiring-within-30d contracts separately', () => {
    // 10 contracts: 1 expired → 1/10×25 = 2.5; 2 expiring in 30d → 2/10×12 = 2.4.
    // Score = round(100 − 4.9) = 95 (riskDeduction 0, LOW-only).
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
    expect(scoreOf(r)).toBe(95);
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
    expect(scoreOf(r)).toBe(98);
  });
});

// ─────────────────────────────────────────────────────────────────
// Overdue obligations (effectiveStatus semantics — unchanged term)
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
    expect(scoreOf(r)).toBe(92); // 2 overdue × 4 = 8 → 92
  });
});

// ─────────────────────────────────────────────────────────────────
// Score bounds
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — bounds', () => {
  it('score stays within [0, 100] under maximum load and lands near the floor', () => {
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
          risk_summary: [{ risk_level: 'HIGH', count: '10000' }],
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
    // ≈ 100 − 45 (risk) − 30 (status cap) − 20 (overdue cap) = 5.
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(r.band).toBe('critical');
  });
});

// ─────────────────────────────────────────────────────────────────
// Drivers — real contributions, ranked, plain counts (no %)
// ─────────────────────────────────────────────────────────────────

describe('computeProjectHealth — drivers', () => {
  it('ranks the biggest contributors first (≤3), carrying the raw entity counts', () => {
    const r = computeProjectHealth(singleContract(17, 139)); // Muhlbauer shape
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;

    expect(r.drivers.length).toBe(3);
    // MEDIUM load (139) dominates HIGH (17·2.5 = 42.5); stalled contributes 8.
    expect(r.drivers.map((d) => d.key)).toEqual(['mediumRisk', 'highRisk', 'stalled']);
    // Counts are the raw entity counts — NOT a deduction/percentage.
    expect(r.drivers.map((d) => d.count)).toEqual([139, 17, 1]);
    // points are whole numbers ≥ 1, sorted descending (ranking only).
    for (const d of r.drivers) {
      expect(Number.isInteger(d.points)).toBe(true);
      expect(d.points).toBeGreaterThanOrEqual(1);
    }
    const pts = r.drivers.map((d) => d.points);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
  });

  it('omits drivers with a zero count (all-clear → no drivers)', () => {
    const r = computeProjectHealth(input());
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    expect(r.drivers).toEqual([]);
  });
});
