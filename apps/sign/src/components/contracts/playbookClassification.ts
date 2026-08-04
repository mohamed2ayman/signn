import type { ComplianceFindingClassification } from '@/services/api/complianceService';

/**
 * 7.22 Slice B — per-finding playbook classification badge (PR #225).
 *
 * Pure display logic, kept out of ComplianceTab.tsx so it is unit-testable
 * without mounting the tab — the same shape as Slice A's `playbookCoverage.ts`
 * (`resolveX(...) => X | null`, where null means "render nothing").
 *
 * ── THE CENTRAL DISTINCTION ────────────────────────────────────────────────
 * MINOR and MAJOR are DEVIATIONS: the org holds a position and this contract
 * misses it. There is a standard to argue from, so the action is NEGOTIATE.
 *
 * NON_STANDARD is a COVERAGE GAP: no playbook position covers this clause type
 * at all (`playbook_position_id` is null because none exists). There is nothing
 * to negotiate against, and the action is ADD A POSITION.
 *
 * Those are different KINDS of thing, not different severities of one thing, so
 * NON_STANDARD is deliberately NOT a third colour on the amber→orange deviation
 * ramp. It differs on FOUR axes at once — shape, fill, border, and icon — and
 * carries an action-oriented label:
 *
 *   MINOR / MAJOR   solid fill · rounded-full pill · no border · warning icon
 *   NON_STANDARD    no fill    · rounded-md chip   · DASHED border · add icon
 *
 * The dashed border is not arbitrary: this codebase already uses `border-dashed`
 * to mean "absent / not yet there" — the dashed avatar for a nameless pending
 * teammate (ProjectPartiesDirectory), the dashed add-party affordance
 * (PartyCard), and every empty state. NON_STANDARD means a position is MISSING,
 * so it inherits that idiom.
 *
 * ── WHAT IT MUST ALSO NOT BE CONFUSED WITH ─────────────────────────────────
 * Three other chips can appear near this one, so all three are avoided:
 *   · PLAYBOOK_STATUS_BADGE (#216 pill) — solid emerald/amber/orange,
 *     rounded-full. Contract-level ROLLUP, a different enum entirely.
 *   · SeverityBadge — solid red/amber/yellow/gray/blue, rounded-full, and it
 *     sits in the SAME finding row.
 *   · The Slice A coverage stat — plain muted text, no chip at all.
 * Red is never used here: it belongs to the legal axis, and a playbook miss is
 * a preference miss, never legal non-compliance (the #216 reasoning).
 */

/** Which KIND of thing the badge represents — drives the whole visual split. */
export type ClassificationKind =
  /** MINOR / MAJOR — a position exists and was missed. Action: negotiate. */
  | 'deviation'
  /** NON_STANDARD — no position exists. Action: add one. */
  | 'gap';

/** Which glyph the renderer draws. Kept as data so this module stays pure. */
export type ClassificationIcon = 'warning' | 'add';

export interface ClassificationBadge {
  classification: ComplianceFindingClassification;
  kind: ClassificationKind;
  /** Full Tailwind class string for the chip. */
  className: string;
  icon: ClassificationIcon;
  /** i18n key for the visible label. */
  labelKey: string;
  /** i18n key for the `title` tooltip naming the action to take. */
  hintKey: string;
}

/**
 * The visual contract, exported so tests can lock it (the PLAYBOOK_STATUS_BADGE
 * convention). Note MINOR/MAJOR share a chip SHAPE and differ only in colour,
 * while NON_STANDARD differs structurally.
 */
export const CLASSIFICATION_BADGE: Record<
  ComplianceFindingClassification,
  Omit<ClassificationBadge, 'classification'>
> = {
  MINOR: {
    kind: 'deviation',
    className:
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700',
    icon: 'warning',
    labelKey: 'complianceTab.classification.MINOR',
    hintKey: 'complianceTab.classification.hint.deviation',
  },
  MAJOR: {
    // Deeper orange, matching the #216 pill's MAJOR_DEVIATIONS reasoning:
    // heavier than MINOR but still NOT the red the legal badge owns.
    kind: 'deviation',
    className:
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-200 text-orange-900',
    icon: 'warning',
    labelKey: 'complianceTab.classification.MAJOR',
    hintKey: 'complianceTab.classification.hint.deviation',
  },
  NON_STANDARD: {
    // Structurally different, not a third ramp colour: unfilled, dashed,
    // rounded-md rather than a pill, slate rather than amber, and an ADD icon.
    kind: 'gap',
    className:
      'inline-flex items-center gap-1 rounded-md border border-dashed border-slate-400 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-slate-600',
    icon: 'add',
    labelKey: 'complianceTab.classification.NON_STANDARD',
    hintKey: 'complianceTab.classification.hint.gap',
  },
};

/**
 * Resolve the badge for a finding's classification.
 *
 * Returns `null` — render NOTHING — when there is no classification to show:
 *   · non-PLAYBOOK findings, which can never carry one (the DB CHECK
 *     `chk_classification_playbook_only` guarantees it);
 *   · PLAYBOOK findings whose value the backend coerced to null via
 *     `coerceEnumOrNull` (model omitted or sent something invalid);
 *   · rows predating PR #225.
 *   · an unrecognised string arriving from the untyped jsonb boundary.
 *
 * Null is never treated as a default classification — same graceful-absence
 * rule as the #216 pill and the Slice A coverage stat.
 */
export function resolveClassificationBadge(
  classification: ComplianceFindingClassification | null | undefined,
): ClassificationBadge | null {
  if (!classification) return null;
  const spec = CLASSIFICATION_BADGE[classification];
  if (!spec) return null;
  return { classification, ...spec };
}
