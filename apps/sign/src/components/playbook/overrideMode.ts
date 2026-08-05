import type { PlaybookPosition } from '@/services/api/playbookService';
import type {
  ComplianceFindingClassification,
  ComplianceFindingLayer,
} from '@/services/api/complianceService';
import { resolveClassificationBadge } from '@/components/contracts/playbookClassification';

/**
 * 7.22 Slice C — which mode the playbook override panel opens in.
 *
 * BEFORE PR #214 a compliance finding carried no link back to the playbook row
 * that provoked it, so the operator had to name the subject by hand. #214 added
 * `compliance_findings.playbook_position_id` (validated against the org's real
 * positions, FK ON DELETE SET NULL) and #225 added `classification`. Together
 * they let the panel work out, without guessing, WHICH position a deviation is
 * against — and, when there is none, whether that is because one was deleted or
 * because none ever existed.
 *
 * Pure decision logic, kept out of the panel so it is unit-testable without
 * mounting the modal — the same shape as Slice A's `playbookCoverage.ts` and
 * Slice B's `playbookClassification.ts`.
 */

/**
 * The positions query's liveness, beyond its data.
 *
 * `data` alone cannot distinguish "never loaded", "refetching a stale cache"
 * and "the request failed" — React Query reports `undefined` data for all
 * three. Conflating them is what strands the panel, so the resolver takes them
 * explicitly. Both flags are optional: omitting them means "settled and fine",
 * which is the right default for a plain unit test.
 */
export interface PositionsStatus {
  /** A request is in flight — initial load or background refetch. */
  isFetching?: boolean;
  /** The load failed. Degrade to the manual picker; never wait forever. */
  isError?: boolean;
}

/** The provenance the panel needs. Mirrors the fields ComplianceTab already holds. */
export interface OverrideFinding {
  requirement: string;
  clause_ref: string | null;
  layer: ComplianceFindingLayer;
  playbook_position_id: string | null;
  classification: ComplianceFindingClassification | null;
}

export type OverrideMode =
  /**
   * A position id is present and the list that could resolve it is still in
   * flight — either it has never loaded, or a warm-but-stale cache is being
   * refetched and the position may yet arrive.
   *
   * THE ASYNC-TIMING GUARD. Resolving eagerly would show the manual picker for
   * a frame and then swap to the linked view — a visible flash, and worse, a
   * picker the user might touch before it vanishes (whereupon adoption would
   * overwrite their choice). This mode says "don't decide yet".
   *
   * It is reachable ONLY when an id is present; every other case is decided
   * from the finding alone and never waits. It is NEVER entered on a failed
   * load — see `isError` in the resolver, which degrades to `manual` so the
   * user always has a usable control rather than an endless spinner.
   */
  | { kind: 'loading' }
  /** Case 1 — auto-linked to the position this deviation is against. */
  | { kind: 'linked'; position: PlaybookPosition }
  /**
   * Case 2 — NON_STANDARD: no position has EVER covered this clause type, so
   * there is no standard to override. The user is authoring their first
   * position for it, which is a different act from narrowing an existing one.
   */
  | { kind: 'addPosition' }
  /**
   * Cases 3 and 4 — the pre-#214 manual picker, unchanged.
   *   Case 3: a PLAYBOOK deviation whose position was DELETED after the check
   *           ran (the FK is ON DELETE SET NULL, so the id went null while the
   *           classification stayed MINOR/MAJOR). Something WAS there; the
   *           operator re-picks the subject.
   *   Case 4: a non-PLAYBOOK finding — defensive only. ComplianceTab renders
   *           the trigger exclusively for `activeLayer === 'PLAYBOOK'`, so this
   *           is unreachable from the live UI.
   *   Plus:   an id that does not resolve against the loaded list. Should not
   *           happen (SET NULL removes dangling ids, and `list()` returns every
   *           row including inactive ones), so it degrades to the picker rather
   *           than dead-ending.
   */
  | { kind: 'manual' };

/**
 * Decide the panel's mode.
 *
 * @param finding    the deviation the panel was opened from, or null.
 * @param positions  the org's positions from the SHARED `PLAYBOOK_QUERY_KEY`
 *                   cache — pass `undefined` while the query is still loading.
 *                   Deliberately a parameter and not a fetch: the panel already
 *                   holds this list, so auto-link costs no extra request.
 *
 * CASE 2 vs CASE 3 — the distinction this function exists for. Both have
 * `playbook_position_id === null`, so the null id ALONE cannot tell them apart;
 * `classification` is what separates them. NON_STANDARD means the finding was
 * raised with no covering position (a coverage gap → ADD one); MINOR/MAJOR mean
 * it was raised against a position that has since gone (→ RE-PICK one). Reading
 * only the null id would send a gap to the picker and ask the user to choose
 * among positions that do not cover the clause.
 */
export function resolveOverrideMode(
  finding: OverrideFinding | null | undefined,
  positions: readonly PlaybookPosition[] | undefined,
  status?: PositionsStatus,
): OverrideMode {
  // Case 4 — nothing to link against.
  if (!finding || finding.layer !== 'PLAYBOOK') return { kind: 'manual' };

  // Case 1 — provenance present. Resolve from cache.
  if (finding.playbook_position_id) {
    const position = positions?.find(
      (p) => p.id === finding.playbook_position_id,
    );
    if (position) return { kind: 'linked', position };

    // Not found — WHY decides the mode, and getting this wrong strands the user.
    //
    // The load FAILED: never wait. `positionsQuery.data` stays `undefined`
    // forever after a rejection, so treating that as "still loading" pins the
    // panel on a spinner with the subject field hidden while Save stays
    // enabled and demands one — an unrecoverable dead-end. Degrade to the
    // manual picker instead: the user loses the auto-link convenience but
    // keeps a working control.
    if (status?.isError) return { kind: 'manual' };

    // Still in flight — never loaded, OR a stale cache is being refetched and
    // the position may yet arrive. Showing the picker here is the flash that
    // lets a user pick a subject adoption would then silently overwrite.
    if (positions === undefined || status?.isFetching) return { kind: 'loading' };

    // Settled, loaded, and genuinely absent — the position was deleted after
    // the check ran (FK ON DELETE SET NULL). Manual picker is correct.
    return { kind: 'manual' };
  }

  // Case 2 vs 3 — no id. `kind === 'gap'` is Slice B's single definition of
  // NON_STANDARD; deriving it here (rather than taking a separate prop) means a
  // caller cannot pass a `kind` that disagrees with the `classification`.
  const badge = resolveClassificationBadge(finding.classification);
  if (badge?.kind === 'gap') return { kind: 'addPosition' };

  return { kind: 'manual' };
}

/**
 * True when the clause-type SELECT must be rendered.
 *
 * Note this is NOT "is in manual-picker mode". In `addPosition` the user is
 * creating their first position for a clause type, and a position cannot be
 * created without naming one — the finding carries `clause_ref` ("14.7", a
 * clause NUMBER), never a clause TYPE, so it cannot be inferred. The field is
 * therefore required there too; what changes is the framing around it (no
 * "current org standard" box, add-a-position labels and CTA).
 *
 * In `linked` mode the subject is already known, so the field is hidden.
 */
export function showsSubjectSelect(mode: OverrideMode): boolean {
  return mode.kind === 'manual' || mode.kind === 'addPosition';
}
