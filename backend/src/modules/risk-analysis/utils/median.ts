/**
 * Phase 7.17 — Prompt 1, B.4.
 *
 * Median of a non-empty integer array. Total order over the inputs;
 * caller is responsible for ensuring the values are valid integers.
 *
 * **Tie-break rule for even-count samples**: lower midpoint (round-down).
 * E.g. computeMedian([2, 3]) returns 2, not 2.5 or 3. This matches the
 * "favor more conservative / less alarmist" preference per the B.4 plan
 * Decision 8 — when half the org thinks Likelihood is 2 and the other
 * half thinks it's 3, the lower value is the more cautious org default.
 * The resolver-blessed default should be conservative enough that
 * individual findings can be adjusted upward by future overrides; a
 * lower baseline preserves that headroom. (The AI extraction is already
 * calibrated to lean high — pairing it with a lower learned baseline
 * keeps the system from over-flagging.)
 *
 * Throws on empty input — the caller (`LearnedBaselineProcessor`) only
 * reaches this function after a non-empty sample is confirmed.
 */
export function computeMedian(values: number[]): number {
  if (values.length === 0) {
    throw new Error('computeMedian called with empty array');
  }
  // Sort a COPY — don't mutate the caller's array.
  const sorted = [...values].sort((a, b) => a - b);
  // Lower-midpoint indexing:
  //   odd n:  Math.floor((n-1)/2) === (n-1)/2     (exact middle)
  //   even n: Math.floor((n-1)/2) === n/2 - 1     (lower of two middles)
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
