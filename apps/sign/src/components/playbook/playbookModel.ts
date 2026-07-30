import type { TFunction } from 'i18next';
import { CLAUSE_TYPE_LABELS } from '@/components/review/ClauseReviewCard';
import {
  VALUE_CONFIG_LIMITS,
  type PlaybookPosition,
  type PlaybookRuleType,
  type PlaybookThresholdDirection,
  type PlaybookValueConfig,
} from '@/services/api/playbookService';

/**
 * 7.22 Slice 3 — pure helpers behind the Playbook manager page.
 *
 * Kept free of React and of the API client so the grouping, the human-readable
 * value rendering, and the draft→value_config build are unit-testable on their
 * own (the partiesModel / hostReviewModel / dashboardAnalytics convention).
 */

// ─── The 17 standard clause types, grouped into families ──────────────────────
//
// The KEYS are the app-wide vocabulary from CLAUSE_TYPE_LABELS
// (components/review/ClauseReviewCard.tsx) — the SAME 17 keys the risk tab and
// clause review use, and the same keys the `clauseType.*` i18n block already
// carries in en/ar/fr. This file introduces NO new clause-type vocabulary; it
// only arranges the existing keys into display families.
//
// The families are a DISPLAY grouping only. The backend stores a flat
// `clause_type` varchar and neither knows nor cares about families.

export type PlaybookFamily =
  | 'commercial'
  | 'risk'
  | 'legal'
  | 'scope'
  | 'custom';

/** Family → the standard clause-type keys under it. Order is display order. */
export const PLAYBOOK_FAMILIES: ReadonlyArray<{
  id: PlaybookFamily;
  clauseTypes: readonly string[];
}> = [
  { id: 'commercial', clauseTypes: ['payment', 'variations', 'time'] },
  {
    id: 'risk',
    clauseTypes: [
      'liability',
      'indemnification',
      'insurance',
      'warranty',
      'defects',
      'force_majeure',
    ],
  },
  {
    id: 'legal',
    clauseTypes: [
      'dispute_resolution',
      'termination',
      'confidentiality',
      'compliance',
      'intellectual_property',
    ],
  },
  { id: 'scope', clauseTypes: ['scope_of_work', 'general', 'other'] },
  // `custom` deliberately lists no clause types — org-invented types land here
  // by virtue of is_custom_clause_type, not by key.
  { id: 'custom', clauseTypes: [] },
];

/** Every standard key, in family display order. Length is exactly 17. */
export const STANDARD_CLAUSE_TYPES: readonly string[] = PLAYBOOK_FAMILIES.flatMap(
  (f) => f.clauseTypes,
);

/** The denominator of the KB card's "X of 17 clause types covered". */
export const STANDARD_CLAUSE_TYPE_COUNT = STANDARD_CLAUSE_TYPES.length;

/**
 * Which family a position displays under.
 *
 * A position is `custom` when the org flagged it so, OR when its clause_type is
 * not one of the 17 — the second arm matters because `is_custom_clause_type` is
 * an optional client-supplied boolean the backend does not derive, so a row can
 * legitimately carry a non-standard key with the flag left false.
 */
export function familyOfPosition(position: PlaybookPosition): PlaybookFamily {
  const key = normalizeClauseTypeKey(position.clause_type);
  if (position.is_custom_clause_type) return 'custom';
  const found = PLAYBOOK_FAMILIES.find((f) => f.clauseTypes.includes(key));
  return found ? found.id : 'custom';
}

/**
 * Mirror of the backend resolver's `normalizeClauseTypeKey`
 * (backend/src/modules/playbook/playbook-resolver.service.ts) — trim + lowercase.
 * Kept identical so the client-side join in the compliance tab groups a
 * position under the same key the backend resolver would.
 */
export function normalizeClauseTypeKey(clauseType: string | null | undefined): string {
  return (clauseType ?? '').trim().toLowerCase();
}

/** Positions grouped for the manager list. Empty families are dropped. */
export function groupPositionsByFamily(
  positions: readonly PlaybookPosition[],
): Array<{ family: PlaybookFamily; positions: PlaybookPosition[] }> {
  return PLAYBOOK_FAMILIES.map((f) => ({
    family: f.id,
    positions: positions.filter((p) => familyOfPosition(p) === f.id),
  })).filter((g) => g.positions.length > 0);
}

/**
 * Coverage for the KB "house rules" card: how many of the 17 STANDARD clause
 * types have at least one ACTIVE position.
 *
 * Custom types are excluded from the numerator on purpose — they are not part
 * of the 17, so counting them could report "19 of 17 covered".
 */
export function coverageOfStandardTypes(
  positions: readonly PlaybookPosition[],
): { covered: number; total: number } {
  const covered = new Set(
    positions
      .filter((p) => p.is_active && !p.is_custom_clause_type)
      .map((p) => normalizeClauseTypeKey(p.clause_type))
      .filter((k) => STANDARD_CLAUSE_TYPES.includes(k)),
  );
  return { covered: covered.size, total: STANDARD_CLAUSE_TYPE_COUNT };
}

// ─── Display ──────────────────────────────────────────────────────────────────

/** Badge palette, matching the REDLINE_STATUS_BADGE idiom. */
export const RULE_TYPE_BADGE: Record<PlaybookRuleType, string> = {
  RANGE: 'bg-blue-100 text-blue-700',
  THRESHOLD: 'bg-amber-100 text-amber-700',
  ENUM: 'bg-violet-100 text-violet-700',
  REQUIRED: 'bg-emerald-100 text-emerald-700',
  TEXT: 'bg-gray-100 text-gray-600',
};

export const SCOPE_BADGE: Record<string, string> = {
  ORG: 'bg-gray-100 text-gray-600',
  PROJECT: 'bg-indigo-50 text-indigo-700',
  CONTRACT: 'bg-teal-50 text-teal-700',
};

/**
 * Latin digits, no locale grouping — CLAUDE.md's Latin-numerals rule for MENA
 * construction finance (lesson #137, and the backend serializer's fmtNumber).
 * `toLocaleString` is deliberately avoided.
 */
function fmtNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/**
 * The human-readable position value shown in the list and in the compliance
 * override popover.
 *
 * Mirrors the SHAPE of the backend serializer's `renderValue`
 * (playbook-serializer.util.ts) so the operator reads the same sentence the AI
 * is given — but localized, because this one is for a human. The backend's
 * version stays English-only and deterministic for the prompt; do not try to
 * share them.
 */
export function renderPositionValue(
  position: Pick<PlaybookPosition, 'rule_type' | 'value_config'>,
  t: TFunction,
): string {
  // via `unknown`: the union's members share no index signature, so a direct
  // cast is rejected. Reading through rule_type is the whole contract here.
  const config = position.value_config as unknown as Record<string, unknown>;

  switch (position.rule_type) {
    case 'RANGE':
      return t('playbook.value.range', {
        min: fmtNumber(config.min as number),
        max: fmtNumber(config.max as number),
        unit: String(config.unit ?? ''),
      });

    case 'THRESHOLD':
      return t(
        config.direction === 'AT_LEAST'
          ? 'playbook.value.atLeast'
          : 'playbook.value.atMost',
        { value: fmtNumber(config.value as number), unit: String(config.unit ?? '') },
      );

    case 'ENUM':
      return t('playbook.value.enum', {
        list: (Array.isArray(config.allowed) ? config.allowed : []).join(', '),
      });

    case 'REQUIRED':
      return t('playbook.value.required');

    case 'TEXT':
      return String(config.text ?? '').trim();

    default:
      // A rule_type this build does not know. Say so plainly rather than
      // rendering a confident-looking blank (the backend serializer's stance).
      return t('playbook.value.unrenderable');
  }
}

/** Localized clause-type label: the 17 standard keys via i18n, custom verbatim. */
export function positionClauseTypeLabel(
  position: Pick<PlaybookPosition, 'clause_type' | 'is_custom_clause_type'>,
  t: TFunction,
): string {
  const raw = (position.clause_type ?? '').trim();
  if (position.is_custom_clause_type) return raw;
  const key = normalizeClauseTypeKey(raw);
  if (CLAUSE_TYPE_LABELS[key]) {
    return t(`clauseType.${key}`, { defaultValue: CLAUSE_TYPE_LABELS[key] });
  }
  return raw;
}

// ─── Form draft → value_config ────────────────────────────────────────────────

/**
 * The modal's value inputs, held as STRINGS regardless of rule_type so the
 * fields survive a rule-type switch without losing what the user typed. The
 * typed `value_config` is built from this only at submit time.
 */
export interface ValueDraft {
  min: string;
  max: string;
  unit: string;
  direction: PlaybookThresholdDirection;
  thresholdValue: string;
  /** One entry per line — the ENUM textarea. */
  allowed: string;
  text: string;
}

export const EMPTY_VALUE_DRAFT: ValueDraft = {
  min: '',
  max: '',
  unit: '',
  direction: 'AT_MOST',
  thresholdValue: '',
  allowed: '',
  text: '',
};

/** Hydrate the draft from an existing position (edit mode). */
export function draftFromPosition(position: PlaybookPosition): ValueDraft {
  const c = position.value_config as unknown as Record<string, unknown>;
  return {
    ...EMPTY_VALUE_DRAFT,
    min: c.min !== undefined ? String(c.min) : '',
    max: c.max !== undefined ? String(c.max) : '',
    unit: typeof c.unit === 'string' ? c.unit : '',
    direction: (c.direction === 'AT_LEAST' ? 'AT_LEAST' : 'AT_MOST') as PlaybookThresholdDirection,
    thresholdValue: c.value !== undefined ? String(c.value) : '',
    allowed: Array.isArray(c.allowed) ? (c.allowed as string[]).join('\n') : '',
    text: typeof c.text === 'string' ? c.text : '',
  };
}

/** Split the ENUM textarea into trimmed, non-empty entries. */
export function parseAllowedList(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a user-typed number. Returns null when not a finite number. */
function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Client-side mirror of backend `validateValueConfig`
 * (backend/src/modules/playbook/dto/value-config.validator.ts).
 *
 * Returns an i18n KEY for the first problem, or null when valid. This exists to
 * give an inline message instead of a raw 400 — the BACKEND REMAINS THE
 * AUTHORITY and re-validates every write, so a drift here can never let an
 * invalid position be stored.
 */
export function validateValueDraft(
  ruleType: PlaybookRuleType,
  draft: ValueDraft,
): string | null {
  switch (ruleType) {
    case 'RANGE': {
      const min = parseFiniteNumber(draft.min);
      const max = parseFiniteNumber(draft.max);
      if (min === null) return 'playbook.errors.minRequired';
      if (max === null) return 'playbook.errors.maxRequired';
      if (min > max) return 'playbook.errors.minGreaterThanMax';
      if (!draft.unit.trim()) return 'playbook.errors.unitRequired';
      if (draft.unit.length > VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH) {
        return 'playbook.errors.unitTooLong';
      }
      return null;
    }

    case 'THRESHOLD': {
      if (parseFiniteNumber(draft.thresholdValue) === null) {
        return 'playbook.errors.valueRequired';
      }
      if (!draft.unit.trim()) return 'playbook.errors.unitRequired';
      if (draft.unit.length > VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH) {
        return 'playbook.errors.unitTooLong';
      }
      return null;
    }

    case 'ENUM': {
      const list = parseAllowedList(draft.allowed);
      if (list.length === 0) return 'playbook.errors.allowedRequired';
      if (list.length > VALUE_CONFIG_LIMITS.ENUM_MAX_ENTRIES) {
        return 'playbook.errors.allowedTooMany';
      }
      if (list.some((e) => e.length > VALUE_CONFIG_LIMITS.ENUM_ENTRY_MAX_LENGTH)) {
        return 'playbook.errors.allowedEntryTooLong';
      }
      return null;
    }

    case 'REQUIRED':
      return null;

    case 'TEXT': {
      if (!draft.text.trim()) return 'playbook.errors.textRequired';
      if (draft.text.length > VALUE_CONFIG_LIMITS.TEXT_MAX_LENGTH) {
        return 'playbook.errors.textTooLong';
      }
      return null;
    }

    default:
      return 'playbook.errors.ruleTypeRequired';
  }
}

/**
 * Build the typed `value_config` for the wire. Call ONLY after
 * `validateValueDraft` returned null — the backend rejects unknown keys, so
 * each branch emits exactly the keys its shape allows and nothing else.
 */
export function buildValueConfig(
  ruleType: PlaybookRuleType,
  draft: ValueDraft,
): PlaybookValueConfig {
  switch (ruleType) {
    case 'RANGE':
      return {
        min: Number(draft.min.trim()),
        max: Number(draft.max.trim()),
        unit: draft.unit.trim(),
      };

    case 'THRESHOLD':
      return {
        direction: draft.direction,
        value: Number(draft.thresholdValue.trim()),
        unit: draft.unit.trim(),
      };

    case 'ENUM':
      return { allowed: parseAllowedList(draft.allowed) };

    case 'REQUIRED':
      return { required: true };

    case 'TEXT':
      return { text: draft.text.trim() };

    default:
      // Unreachable for the five known rule types; REQUIRED is the only shape
      // with no user input, so it is the safe structural fallback.
      return { required: true };
  }
}

export const RULE_TYPES: readonly PlaybookRuleType[] = [
  'RANGE',
  'THRESHOLD',
  'ENUM',
  'REQUIRED',
  'TEXT',
];
