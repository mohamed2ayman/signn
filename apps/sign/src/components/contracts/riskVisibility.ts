/**
 * Risk-tab clutter reduction — the DEFAULT "top-2 visible" ranking for the Risk
 * tab. MIRRORS the backend `risk-visibility.util.ts` exactly (severity + distinct
 * tiebreaker); keep the two in lock-step — the backend uses the same rule for
 * completeness + the gold export.
 *
 *   1) severity HIGH > MEDIUM > LOW; null/unknown LAST.
 *   2) within a severity tier, skip a near-duplicate (same normalized 40-char
 *      description prefix) so the visible 2 aren't near-copies; backfill if
 *      skipping would leave < 2.
 *   3) take the first 2. Stable within a tier (input/server order preserved).
 */
import type { RiskAnalysis } from '@/types';

const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function severityRank(level: string | null | undefined): number {
  return level ? SEVERITY_RANK[level] ?? 0 : 0;
}

function normPrefix(desc: string | null | undefined): string {
  return (desc ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Default visible risk ids (up to 2) for one clause's live (non-deleted) risks. */
export function computeDefaultVisibleIds(risks: RiskAnalysis[]): string[] {
  const sorted = risks
    .map((r, i) => ({ r, i }))
    .sort((a, b) => severityRank(b.r.risk_level) - severityRank(a.r.risk_level) || a.i - b.i)
    .map((x) => x.r);

  const picked: RiskAnalysis[] = [];
  for (const r of sorted) {
    if (picked.length === 2) break;
    const nearDup = picked.some(
      (p) =>
        severityRank(p.risk_level) === severityRank(r.risk_level) &&
        normPrefix(p.description) === normPrefix(r.description),
    );
    if (nearDup) continue;
    picked.push(r);
  }
  if (picked.length < 2) {
    for (const r of sorted) {
      if (picked.length === 2) break;
      if (!picked.includes(r)) picked.push(r);
    }
  }
  return picked.map((p) => p.id);
}

/** Resolve visible ids for a clause: a valid swap override wins, else the default. */
export function resolveVisibleIds(
  risks: RiskAnalysis[],
  override: string[] | null | undefined,
): string[] {
  const live = new Set(risks.map((r) => r.id));
  if (override && override.length) {
    const valid = override.filter((id) => live.has(id)).slice(0, 2);
    if (valid.length === 2) return valid;
    const def = computeDefaultVisibleIds(risks).filter((id) => !valid.includes(id));
    return [...valid, ...def].slice(0, 2);
  }
  return computeDefaultVisibleIds(risks);
}

/** Split a clause's risks into { visible: [≤2], hidden: [...] } preserving order. */
export function splitVisibleHidden(
  risks: RiskAnalysis[],
  override: string[] | null | undefined,
): { visible: RiskAnalysis[]; hidden: RiskAnalysis[]; visibleIds: string[] } {
  const visibleIds = resolveVisibleIds(risks, override);
  const vset = new Set(visibleIds);
  // Keep the visible pair in ranked order (visibleIds order), hidden in server order.
  const byId = new Map(risks.map((r) => [r.id, r]));
  const visible = visibleIds.map((id) => byId.get(id)!).filter(Boolean);
  const hidden = risks.filter((r) => !vset.has(r.id));
  return { visible, hidden, visibleIds };
}
