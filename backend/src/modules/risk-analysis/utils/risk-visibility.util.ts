/**
 * Risk-tab clutter reduction — the DEFAULT "top-2 visible" ranking, shared by
 * the completeness + export logic. The frontend (RiskAnalysisTab) mirrors this
 * exact rule for display; keep the two in lock-step (a drift test guards the
 * ordering).
 *
 * Rule:
 *   1) severity: HIGH > MEDIUM > LOW; null / unknown severity LAST.
 *   2) distinct tiebreaker (NO LLM): within the same severity tier, skip a
 *      candidate whose normalized-description prefix matches an already-picked
 *      one, so the visible 2 aren't near-copies. If skipping would leave < 2,
 *      backfill (a clause must still surface 2 when it has ≥ 2 risks).
 *   3) take the first 2.
 *
 * Stable within a tier: input order (the server ordering) is preserved for ties,
 * so the pick is deterministic.
 */

export interface RankableRisk {
  id: string;
  risk_level: string | null | undefined;
  description: string | null | undefined;
}

const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function severityRank(level: string | null | undefined): number {
  return level ? SEVERITY_RANK[level] ?? 0 : 0;
}

function normPrefix(desc: string | null | undefined): string {
  return (desc ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Compute the default visible risk ids (up to 2) for ONE clause's risks.
 * `risks` should already exclude soft-deleted rows and be in the server order.
 */
export function computeDefaultVisibleIds(risks: RankableRisk[]): string[] {
  // Stable sort by severity DESC (ties keep input order).
  const sorted = risks
    .map((r, i) => ({ r, i }))
    .sort((a, b) => severityRank(b.r.risk_level) - severityRank(a.r.risk_level) || a.i - b.i)
    .map((x) => x.r);

  const picked: RankableRisk[] = [];
  for (const r of sorted) {
    if (picked.length === 2) break;
    const nearDup = picked.some(
      (p) => severityRank(p.risk_level) === severityRank(r.risk_level) && normPrefix(p.description) === normPrefix(r.description),
    );
    if (nearDup) continue;
    picked.push(r);
  }
  // Backfill if the distinct-skip left < 2 (a clause with ≥2 risks must show 2).
  if (picked.length < 2) {
    for (const r of sorted) {
      if (picked.length === 2) break;
      if (!picked.includes(r)) picked.push(r);
    }
  }
  return picked.map((p) => p.id);
}

/**
 * Resolve the VISIBLE risk ids for a clause: a stored swap override wins when it
 * is present AND valid (exactly its ids still exist among the clause's live
 * risks); otherwise the deterministic default. Returns ids that are guaranteed
 * to exist in `risks` (a stale override id is dropped and the default fills in).
 */
export function resolveVisibleIds(
  risks: RankableRisk[],
  override: string[] | null | undefined,
): string[] {
  const live = new Set(risks.map((r) => r.id));
  if (override && override.length) {
    const valid = override.filter((id) => live.has(id)).slice(0, 2);
    if (valid.length === 2) return valid;
    // Partial/stale override — keep the valid ones, fill the rest from default.
    const def = computeDefaultVisibleIds(risks).filter((id) => !valid.includes(id));
    return [...valid, ...def].slice(0, 2);
  }
  return computeDefaultVisibleIds(risks);
}
