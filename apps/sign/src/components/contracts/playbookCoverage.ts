/**
 * 7.22 Slice A — the "N of M on standard" playbook-coverage stat.
 *
 * Pure display logic for `findings_summary.playbook_relevant_count` (M) and
 * `playbook_on_standard_count` (N), shipped by PR #225. Kept OUT of
 * ComplianceTab.tsx so it can be unit-tested without rendering the tab (the
 * `hostReviewModel.ts` / `playbookModel.ts` convention).
 *
 * WHAT M AND N ACTUALLY COUNT: M is the number of playbook POSITIONS fed to
 * the check, not the number of contract clauses — the agent computes
 * `m = len(playbook_positions)` and `n = max(m - distinct_deviated_positions, 0)`
 * (ai-backend `ComplianceCheckerAgent._add_playbook_counts`). The copy says
 * "positions" for that reason; calling them "clauses" would misstate the
 * denominator a reviewer is reading.
 *
 * N IS EMITTED, NEVER DERIVED. PR #225 deliberately has the agent emit N so
 * the model and the UI cannot silently disagree on a number a lawyer reads.
 * Nothing here recomputes it from the findings list.
 */

/** Display outcome for the coverage stat. `null` from the resolver = render nothing. */
export type PlaybookCoverage =
  /**
   * M === 0 — the check ran with NO playbook positions at all.
   *
   * This case is shown rather than hidden ON PURPOSE. The backend's
   * `derivePlaybookStatus` returns `'ON_STANDARD'` when there are zero PLAYBOOK
   * findings (`if (playbook.length === 0) return 'ON_STANDARD'`), so an org with
   * no playbook still gets a green "Playbook: On standard" pill. Left alone that
   * reads as "your playbook passed" when no playbook was ever applied. This
   * state exists to contradict that false confidence explicitly.
   */
  | { kind: 'noPositions' }
  /** M > 0 and N is coherent — render "N of M positions on standard". */
  | { kind: 'counts'; onStandard: number; relevant: number };

/** A count is usable only if it is a real, non-negative integer. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Resolve the coverage stat from the two raw summary counts.
 *
 * Returns `null` (render NOTHING) rather than guessing whenever the data cannot
 * support an honest statement — the same graceful-absence principle as the
 * PR #216 pill, which bails via `if (!status || !(status in ...)) return null`.
 *
 * `null` is returned when:
 *   - M is absent or not a valid count. Both counts are optional: they are
 *     missing on the FAILED branch (which writes only `error`), on rows that
 *     predate PR #225, and on the backend `summarize()` fallback, which emits
 *     neither.
 *   - M > 0 but N is absent or incoherent (not a count, or greater than M).
 *     Defaulting N to 0 here would render "0 of 5 positions on standard" —
 *     actively false, and worse than showing nothing.
 */
export function resolvePlaybookCoverage(
  relevantCount: number | null | undefined,
  onStandardCount: number | null | undefined,
): PlaybookCoverage | null {
  if (!isCount(relevantCount)) return null;
  if (relevantCount === 0) return { kind: 'noPositions' };
  if (!isCount(onStandardCount) || onStandardCount > relevantCount) return null;
  return {
    kind: 'counts',
    onStandard: onStandardCount,
    relevant: relevantCount,
  };
}

/** i18n key for a resolved coverage state. */
export function playbookCoverageKey(coverage: PlaybookCoverage): string {
  return coverage.kind === 'noPositions'
    ? 'complianceTab.playbookCoverage.noPositions'
    : 'complianceTab.playbookCoverage.onStandard';
}
