/**
 * "Needs your attention" derivations — 7.20 slice 2.
 *
 * PURE functions, no fetching. All three feeds reuse Slice 1's shared
 * query data (['project-dashboard'|'project-contracts'|'project-obligations']).
 *
 * The primary correctness rule of this slice: OVERDUE is a DERIVED state.
 * Most overdue obligations sit in the DB as PENDING/IN_PROGRESS with a past
 * due_date until the reminder pass flips them — `effectiveStatus()` is the
 * single source of that derivation (statusUtils). Filtering on
 * `status === 'OVERDUE'` alone silently undercounts.
 */
import {
  effectiveStatus,
  daysUntil,
} from '@/components/obligations/statusUtils';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import type { ProjectDashboard } from '@/services/api/projectService';
import type { Contract } from '@/types';

/**
 * `expiry_date` is on the wire (GET /contracts) but undeclared on the shared
 * Contract type — local extension per lesson #210.
 */
export type ContractWithExpiry = Contract & { expiry_date?: string | null };

export interface ExpiryEntry {
  contract: ContractWithExpiry;
  /** Day-granularity distance to expiry: 0 = due today, negative = expired. */
  daysLeft: number;
}

/** Overdue obligations (derived via effectiveStatus), most-overdue first. */
export function deriveOverdueObligations(
  obligations: ObligationPortfolioItem[],
): ObligationPortfolioItem[] {
  return obligations
    .filter((o) => effectiveStatus(o.status, o.due_date) === 'OVERDUE')
    .sort(
      (a, b) =>
        (daysUntil(a.due_date) ?? 0) - (daysUntil(b.due_date) ?? 0), // most negative first
    );
}

/**
 * Split contracts into expiring-within-30-days and already-expired.
 * Day-granularity via statusUtils.daysUntil: due today (0) and 30-days-out
 * (30) are IN the expiring window; 31+ is out; past dates are EXPIRED, never
 * "expiring". Window length shares projectHealth's EXPIRING_WINDOW_DAYS
 * semantics (30).
 */
export const EXPIRY_WINDOW_DAYS = 30;

export function deriveContractExpiry(contracts: ContractWithExpiry[]): {
  expiring: ExpiryEntry[];
  expired: ExpiryEntry[];
} {
  const expiring: ExpiryEntry[] = [];
  const expired: ExpiryEntry[] = [];
  for (const c of contracts) {
    if (!c.expiry_date) continue;
    const days = daysUntil(c.expiry_date);
    if (days === null || Number.isNaN(days)) continue;
    if (days < 0) expired.push({ contract: c, daysLeft: days });
    else if (days <= EXPIRY_WINDOW_DAYS) expiring.push({ contract: c, daysLeft: days });
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft); // soonest first
  expired.sort((a, b) => a.daysLeft - b.daysLeft); // longest-expired first
  return { expiring, expired };
}

/**
 * HIGH-risk finding count from getDashboard().risk_summary.
 * Lesson #210 landmines: counts are STRINGS (Number them) and the array is
 * SPARSE (no HIGH row means 0, never undefined/NaN).
 */
export function deriveHighRiskCount(dashboard: ProjectDashboard): number {
  const row = dashboard.risk_summary.find((r) => r.risk_level === 'HIGH');
  return row ? Number(row.count) || 0 : 0;
}
