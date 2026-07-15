/**
 * Project Health scoring — 7.20 slice 1 (risk term reworked — Issue 2, Option A).
 *
 * PURE function: no fetching, no clock injection beyond Date.now(), fully
 * unit-testable. The weights below are a TUNABLE PRODUCT DECISION — a
 * starting point, not a contract. Change them here and nowhere else.
 *
 * Endpoint-shape landmines handled here (see the 7.20 recon reference):
 *  1. GET /projects/:id/dashboard breakdown counts arrive as STRINGS
 *     (raw PG COUNT(*) via getRawMany) — every count goes through Number().
 *  2. The breakdown arrays are SPARSE — a level/status with zero rows is
 *     absent entirely, so records are zero-filled before any math.
 *  3. (Future slices) by_status keys are the RAW 12 ContractStatus values;
 *     a 12-status → 6-bucket fold is required before feeding StatusPie.
 *
 * Risk term — WHY a saturating curve (Issue 2): the previous risk term was a
 * linear per-contract share hard-capped at 45. A single heavily-analysed
 * contract routinely carries 40–160 findings, so (findings/contracts)·weight
 * blew past the cap for EVERY project → the risk deduction pegged at 45 and
 * the score was stuck (all projects the same). It is now a severity-weighted
 * load fed through an exponential-saturation curve with smooth diminishing
 * returns: it approaches — but never reaches — RISK_MAX_DEDUCTION, so the
 * score regains per-project discrimination. See
 * docs/project-health-investigation.md.
 */
import { effectiveStatus } from '@/components/obligations/statusUtils';
import type { ObligationStatus } from '@/services/api/complianceService';
import type { ProjectDashboard } from '@/services/api/projectService';

// ─── Tunable weights (product decision — keep named, never inline) ───────
export const HEALTH_WEIGHTS = {
  /** Severity weight per HIGH finding in the risk load. The HIGH:MEDIUM ratio
   *  (2.5 : 1) preserves the previous 45:18 severity ratio. */
  RISK_HIGH_WEIGHT: 2.5,
  /** Severity weight per MEDIUM finding in the risk load. */
  RISK_MEDIUM_WEIGHT: 1,
  /** Asymptotic ceiling of the risk-exposure deduction — approached, never
   *  reached, by the saturating curve. */
  RISK_MAX_DEDUCTION: 45,
  /** Saturation constant K for the risk curve RISK_MAX·(1 − e^(−load/K)).
   *  Sized (K = 50 / ln 2 ≈ 72) so a per-contract weighted load of ≈50 yields
   *  ≈half the ceiling, giving roughly: load ≈ 5 → ≈3 pts (small),
   *  load ≈ 50 → ≈22 pts (mid), load ≥ 200 → ≈42 pts (near the ceiling). */
  RISK_SATURATION_K: 72,
  /** Per-contract share of contracts already past expiry_date. */
  EXPIRED: 25,
  /** Per-contract share of contracts expiring within the next 30 days. */
  EXPIRING_30D: 12,
  /** Per-contract share of stalled drafts (DRAFT + CHANGES_REQUESTED). */
  STALLED_DRAFT: 8,
  /** Cap on the combined contract-status deduction. */
  STATUS_CAP: 30,
  /** Flat points per overdue obligation. */
  OVERDUE_PER_OBLIGATION: 4,
  /** Cap on the overdue-obligations deduction. */
  OVERDUE_CAP: 20,
  /** Window (days) for "expiring soon". */
  EXPIRING_WINDOW_DAYS: 30,
} as const;

export type HealthBand = 'healthy' | 'atRisk' | 'critical';

export type HealthDriverKey =
  | 'highRisk'
  | 'mediumRisk'
  | 'expired'
  | 'expiring'
  | 'stalled'
  | 'overdueObligations';

export interface HealthDriver {
  key: HealthDriverKey;
  /**
   * Whole-number contribution this driver makes to the total deduction. Used
   * ONLY to rank "what hurts most" — the UI shows the plain `count`, never
   * this value or a percentage.
   */
  points: number;
  /** Underlying entity count (findings / contracts / obligations). */
  count: number;
}

/**
 * Contract input. `expiry_date` is returned by GET /contracts on the wire
 * but is NOT declared on the frontend `Contract` type — callers bind via a
 * locally-extended type (see ProjectDetailPage).
 */
export interface HealthContractInput {
  status: string;
  expiry_date?: string | null;
}

export interface HealthObligationInput {
  status: ObligationStatus;
  due_date: string | null;
}

export interface ProjectHealthInput {
  dashboard: ProjectDashboard;
  contracts: HealthContractInput[];
  obligations: HealthObligationInput[];
}

export type ProjectHealthResult =
  | { sufficient: false }
  | { sufficient: true; score: number; band: HealthBand; drivers: HealthDriver[] };

/** Zero-fill a sparse `{key, count-string}[]` breakdown into a numeric record. */
function foldCounts<K extends string>(
  rows: ReadonlyArray<Record<string, string>>,
  keyField: string,
  keys: readonly K[],
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) {
    const k = row[keyField] as K;
    if (k in out) out[k] = Number(row.count) || 0; // landmines 1 + 2
  }
  return out;
}

export function computeProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  const W = HEALTH_WEIGHTS;
  const totalContracts = input.dashboard.contracts.total;

  const risk = foldCounts(input.dashboard.risk_summary, 'risk_level', [
    'LOW',
    'MEDIUM',
    'HIGH',
  ] as const);
  const analysedFindings = risk.LOW + risk.MEDIUM + risk.HIGH;

  // Insufficient-data guard: a project with no contracts, or whose contracts
  // have no risk-analysis rows yet, must show a NEUTRAL state — never a
  // misleading low/red score. (What counts as "analysed" is itself tunable.)
  if (totalContracts === 0 || analysedFindings === 0) {
    return { sufficient: false };
  }

  // ── Risk exposure — SATURATING curve (cap → RISK_MAX_DEDUCTION) ─────────
  // Severity-weighted findings load per contract (HIGH weighted above MEDIUM);
  // fed through RISK_MAX·(1 − e^(−load/K)) for smooth diminishing returns.
  const highLoad = risk.HIGH * W.RISK_HIGH_WEIGHT;
  const mediumLoad = risk.MEDIUM * W.RISK_MEDIUM_WEIGHT;
  const riskLoad = (highLoad + mediumLoad) / totalContracts;
  const riskDeduction =
    W.RISK_MAX_DEDUCTION * (1 - Math.exp(-riskLoad / W.RISK_SATURATION_K));

  // ── Contract status (cap −STATUS_CAP) ──────────────────────────────────
  const now = Date.now();
  const windowEnd = now + W.EXPIRING_WINDOW_DAYS * 86_400_000;
  let expiredCount = 0;
  let expiringCount = 0;
  for (const c of input.contracts) {
    if (!c.expiry_date) continue;
    const exp = new Date(c.expiry_date).getTime();
    if (Number.isNaN(exp)) continue;
    if (exp < now) expiredCount++;
    else if (exp <= windowEnd) expiringCount++;
  }
  const status = foldCounts(input.dashboard.contracts.by_status, 'status', [
    'DRAFT',
    'CHANGES_REQUESTED',
  ] as const);
  const stalledCount = status.DRAFT + status.CHANGES_REQUESTED;

  const expiredDeduction = (expiredCount / totalContracts) * W.EXPIRED;
  const expiringDeduction = (expiringCount / totalContracts) * W.EXPIRING_30D;
  const stalledDeduction = (stalledCount / totalContracts) * W.STALLED_DRAFT;
  const statusDeduction = Math.min(
    expiredDeduction + expiringDeduction + stalledDeduction,
    W.STATUS_CAP,
  );

  // ── Overdue obligations (cap −OVERDUE_CAP) ─────────────────────────────
  const overdueCount = input.obligations.filter(
    (o) => effectiveStatus(o.status, o.due_date) === 'OVERDUE',
  ).length;
  const overdueDeduction = Math.min(
    overdueCount * W.OVERDUE_PER_OBLIGATION,
    W.OVERDUE_CAP,
  );

  const score = Math.min(
    100,
    Math.max(0, Math.round(100 - riskDeduction - statusDeduction - overdueDeduction)),
  );

  const band: HealthBand = score >= 80 ? 'healthy' : score >= 55 ? 'atRisk' : 'critical';

  // ── Drivers: each driver's REAL (bounded) contribution to the deduction,
  // used ONLY for ranking "what hurts most" — the UI shows the plain count.
  // The single risk deduction is split between HIGH/MEDIUM by weighted-load
  // share; the status deduction is split across its components by the same
  // proportion its cap applied. So driver points sum to (100 − score).
  const totalLoad = highLoad + mediumLoad;
  const highContribution = totalLoad > 0 ? riskDeduction * (highLoad / totalLoad) : 0;
  const mediumContribution = totalLoad > 0 ? riskDeduction * (mediumLoad / totalLoad) : 0;

  const statusRaw = expiredDeduction + expiringDeduction + stalledDeduction;
  const statusScale = statusRaw > 0 ? statusDeduction / statusRaw : 0;

  const components: HealthDriver[] = [
    { key: 'highRisk', points: Math.round(highContribution), count: risk.HIGH },
    { key: 'mediumRisk', points: Math.round(mediumContribution), count: risk.MEDIUM },
    { key: 'expired', points: Math.round(expiredDeduction * statusScale), count: expiredCount },
    { key: 'expiring', points: Math.round(expiringDeduction * statusScale), count: expiringCount },
    { key: 'stalled', points: Math.round(stalledDeduction * statusScale), count: stalledCount },
    {
      key: 'overdueObligations',
      points: Math.round(overdueDeduction),
      count: overdueCount,
    },
  ];
  const drivers = components
    .filter((d) => d.points >= 1 && d.count > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  return { sufficient: true, score, band, drivers };
}
