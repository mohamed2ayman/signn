import { describe, it, expect } from 'vitest';
import { CLAUSE_TYPE_LABELS } from '@/components/review/ClauseReviewCard';
import {
  PLAYBOOK_FAMILIES,
  STANDARD_CLAUSE_TYPES,
  STANDARD_CLAUSE_TYPE_COUNT,
  familyOfPosition,
  groupPositionsByFamily,
  coverageOfStandardTypes,
  renderPositionValue,
  positionClauseTypeLabel,
  normalizeClauseTypeKey,
  validateValueDraft,
  buildValueConfig,
  draftFromPosition,
  parseAllowedList,
  EMPTY_VALUE_DRAFT,
  RULE_TYPE_BADGE,
  RULE_TYPES,
  type ValueDraft,
} from './playbookModel';
import type {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookValueConfig,
} from '@/services/api/playbookService';

/** A `t` that echoes the key + sorted interpolation values, so assertions can
 *  see BOTH which key was chosen and what was interpolated, without depending
 *  on real translations. */
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (!opts) return key;
  const { defaultValue, ...rest } = opts as Record<string, unknown>;
  const parts = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${String(rest[k])}`);
  return parts.length ? `${key}(${parts.join(',')})` : key;
}) as never;

function position(over: Partial<PlaybookPosition> = {}): PlaybookPosition {
  return {
    id: 'p1',
    organization_id: 'org1',
    scope: 'ORG',
    project_id: null,
    contract_id: null,
    clause_type: 'payment',
    is_custom_clause_type: false,
    rule_type: 'RANGE',
    value_config: { min: 28, max: 45, unit: 'days' },
    note: null,
    is_active: true,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

// ─── Family taxonomy ──────────────────────────────────────────────────────────

describe('clause-type family taxonomy', () => {
  it('covers EXACTLY the 17 real clause-type keys — no more, no less', () => {
    // Drift guard: if CLAUSE_TYPE_LABELS gains/loses a key and the families are
    // not updated, a clause type would silently vanish from the manager page.
    expect([...STANDARD_CLAUSE_TYPES].sort()).toEqual(
      Object.keys(CLAUSE_TYPE_LABELS).sort(),
    );
  });

  it('has exactly 17 standard clause types', () => {
    expect(STANDARD_CLAUSE_TYPE_COUNT).toBe(17);
    expect(Object.keys(CLAUSE_TYPE_LABELS)).toHaveLength(17);
  });

  it('never lists the same clause type under two families', () => {
    expect(new Set(STANDARD_CLAUSE_TYPES).size).toBe(STANDARD_CLAUSE_TYPES.length);
  });

  it('reserves the custom family for org-invented types (it lists no keys)', () => {
    const custom = PLAYBOOK_FAMILIES.find((f) => f.id === 'custom');
    expect(custom?.clauseTypes).toEqual([]);
  });
});

describe('familyOfPosition', () => {
  it.each([
    ['payment', 'commercial'],
    ['variations', 'commercial'],
    ['time', 'commercial'],
    ['liability', 'risk'],
    ['force_majeure', 'risk'],
    ['dispute_resolution', 'legal'],
    ['intellectual_property', 'legal'],
    ['scope_of_work', 'scope'],
    ['other', 'scope'],
  ])('puts %s under %s', (clauseType, expected) => {
    expect(familyOfPosition(position({ clause_type: clauseType }))).toBe(expected);
  });

  it('routes a flagged custom type to the custom family', () => {
    expect(
      familyOfPosition(
        position({ clause_type: 'Site Access', is_custom_clause_type: true }),
      ),
    ).toBe('custom');
  });

  it('routes an UNFLAGGED non-standard type to custom too', () => {
    // is_custom_clause_type is an optional client-supplied boolean the backend
    // does not derive — an unflagged custom key must not vanish from the list.
    expect(
      familyOfPosition(
        position({ clause_type: 'site_access', is_custom_clause_type: false }),
      ),
    ).toBe('custom');
  });

  it('matches the standard key case-insensitively and trimmed', () => {
    expect(familyOfPosition(position({ clause_type: '  PAYMENT ' }))).toBe(
      'commercial',
    );
  });
});

describe('groupPositionsByFamily', () => {
  it('groups in family display order and drops empty families', () => {
    const groups = groupPositionsByFamily([
      position({ id: 'a', clause_type: 'liability' }),
      position({ id: 'b', clause_type: 'payment' }),
      position({ id: 'c', clause_type: 'termination' }),
    ]);
    expect(groups.map((g) => g.family)).toEqual(['commercial', 'risk', 'legal']);
    expect(groups[0].positions.map((p) => p.id)).toEqual(['b']);
  });

  it('returns [] for no positions', () => {
    expect(groupPositionsByFamily([])).toEqual([]);
  });

  it('never drops a position', () => {
    const input = [
      position({ id: 'a', clause_type: 'payment' }),
      position({ id: 'b', clause_type: 'weird_org_thing' }),
      position({ id: 'c', clause_type: 'insurance' }),
    ];
    const total = groupPositionsByFamily(input).reduce(
      (n, g) => n + g.positions.length,
      0,
    );
    expect(total).toBe(input.length);
  });
});

// ─── Coverage (drives the KB card) ────────────────────────────────────────────

describe('coverageOfStandardTypes', () => {
  it('counts DISTINCT active standard types', () => {
    expect(
      coverageOfStandardTypes([
        position({ id: 'a', clause_type: 'payment' }),
        position({ id: 'b', clause_type: 'payment', scope: 'PROJECT' }),
        position({ id: 'c', clause_type: 'liability' }),
      ]),
    ).toEqual({ covered: 2, total: 17 });
  });

  it('excludes INACTIVE positions', () => {
    expect(
      coverageOfStandardTypes([
        position({ id: 'a', clause_type: 'payment', is_active: false }),
      ]),
    ).toEqual({ covered: 0, total: 17 });
  });

  it('excludes CUSTOM types so coverage can never exceed 17', () => {
    const all = STANDARD_CLAUSE_TYPES.map((ct, i) =>
      position({ id: `s${i}`, clause_type: ct }),
    );
    const withCustoms = [
      ...all,
      position({ id: 'c1', clause_type: 'Site Access', is_custom_clause_type: true }),
      position({ id: 'c2', clause_type: 'Camp Rules', is_custom_clause_type: true }),
    ];
    expect(coverageOfStandardTypes(withCustoms)).toEqual({ covered: 17, total: 17 });
  });

  it('is 0 of 17 for an empty playbook', () => {
    expect(coverageOfStandardTypes([])).toEqual({ covered: 0, total: 17 });
  });
});

// ─── Value rendering ──────────────────────────────────────────────────────────

describe('renderPositionValue', () => {
  it('renders RANGE with Latin numerals and the unit', () => {
    expect(
      renderPositionValue(
        { rule_type: 'RANGE', value_config: { min: 28, max: 45, unit: 'days' } },
        t,
      ),
    ).toBe('playbook.value.range(max=45,min=28,unit=days)');
  });

  it('renders THRESHOLD AT_MOST and AT_LEAST via DIFFERENT keys', () => {
    expect(
      renderPositionValue(
        {
          rule_type: 'THRESHOLD',
          value_config: { direction: 'AT_MOST', value: 10, unit: 'percent' },
        },
        t,
      ),
    ).toBe('playbook.value.atMost(unit=percent,value=10)');
    expect(
      renderPositionValue(
        {
          rule_type: 'THRESHOLD',
          value_config: { direction: 'AT_LEAST', value: 100, unit: 'percent' },
        },
        t,
      ),
    ).toBe('playbook.value.atLeast(unit=percent,value=100)');
  });

  it('renders ENUM as a comma-joined list', () => {
    expect(
      renderPositionValue(
        { rule_type: 'ENUM', value_config: { allowed: ['ICC', 'LCIA'] } },
        t,
      ),
    ).toBe('playbook.value.enum(list=ICC, LCIA)');
  });

  it('renders REQUIRED with no interpolation', () => {
    expect(
      renderPositionValue(
        { rule_type: 'REQUIRED', value_config: { required: true } },
        t,
      ),
    ).toBe('playbook.value.required');
  });

  it('renders TEXT verbatim (trimmed), including Arabic', () => {
    expect(
      renderPositionValue(
        { rule_type: 'TEXT', value_config: { text: '  الدفع خلال 30 يوماً  ' } },
        t,
      ),
    ).toBe('الدفع خلال 30 يوماً');
  });

  it('says so plainly for an unknown rule_type rather than rendering blank', () => {
    expect(
      renderPositionValue(
        { rule_type: 'MYSTERY' as PlaybookRuleType, value_config: {} as PlaybookValueConfig },
        t,
      ),
    ).toBe('playbook.value.unrenderable');
  });

  it('uses Latin digits — never locale-grouped output', () => {
    const out = renderPositionValue(
      { rule_type: 'RANGE', value_config: { min: 1000, max: 250000, unit: 'EGP' } },
      t,
    );
    expect(out).toContain('1000');
    expect(out).toContain('250000');
    expect(out).not.toContain(','.concat('000')); // no thousands separators
  });
});

describe('positionClauseTypeLabel', () => {
  it('localizes a standard key via the existing clauseType.* block', () => {
    expect(
      positionClauseTypeLabel(
        { clause_type: 'payment', is_custom_clause_type: false },
        t,
      ),
    ).toBe('clauseType.payment');
  });

  it('renders a custom type VERBATIM — never upper-cased or translated', () => {
    expect(
      positionClauseTypeLabel(
        { clause_type: 'قواعد الموقع', is_custom_clause_type: true },
        t,
      ),
    ).toBe('قواعد الموقع');
  });

  it('falls back to the raw value for an unknown unflagged key', () => {
    expect(
      positionClauseTypeLabel(
        { clause_type: 'site_access', is_custom_clause_type: false },
        t,
      ),
    ).toBe('site_access');
  });
});

describe('normalizeClauseTypeKey', () => {
  it('trims and lowercases, mirroring the backend resolver', () => {
    expect(normalizeClauseTypeKey('  Dispute_Resolution ')).toBe(
      'dispute_resolution',
    );
  });

  it('is total for null/undefined', () => {
    expect(normalizeClauseTypeKey(null)).toBe('');
    expect(normalizeClauseTypeKey(undefined)).toBe('');
  });
});

// ─── Draft validation (mirrors the backend validator) ─────────────────────────

function draft(over: Partial<ValueDraft> = {}): ValueDraft {
  return { ...EMPTY_VALUE_DRAFT, ...over };
}

describe('validateValueDraft', () => {
  it('accepts a well-formed RANGE', () => {
    expect(
      validateValueDraft('RANGE', draft({ min: '28', max: '45', unit: 'days' })),
    ).toBeNull();
  });

  it.each([
    [draft({ max: '45', unit: 'days' }), 'playbook.errors.minRequired'],
    [draft({ min: '28', unit: 'days' }), 'playbook.errors.maxRequired'],
    [draft({ min: '50', max: '10', unit: 'days' }), 'playbook.errors.minGreaterThanMax'],
    [draft({ min: '28', max: '45' }), 'playbook.errors.unitRequired'],
    [draft({ min: 'abc', max: '45', unit: 'd' }), 'playbook.errors.minRequired'],
  ])('rejects a bad RANGE with the right message', (d, expected) => {
    expect(validateValueDraft('RANGE', d)).toBe(expected);
  });

  it('accepts min === max (the backend allows <=)', () => {
    expect(
      validateValueDraft('RANGE', draft({ min: '30', max: '30', unit: 'days' })),
    ).toBeNull();
  });

  it('rejects a unit longer than the backend limit', () => {
    expect(
      validateValueDraft(
        'RANGE',
        draft({ min: '1', max: '2', unit: 'x'.repeat(51) }),
      ),
    ).toBe('playbook.errors.unitTooLong');
  });

  it('validates THRESHOLD', () => {
    expect(
      validateValueDraft(
        'THRESHOLD',
        draft({ thresholdValue: '10', unit: 'percent' }),
      ),
    ).toBeNull();
    expect(validateValueDraft('THRESHOLD', draft({ unit: 'percent' }))).toBe(
      'playbook.errors.valueRequired',
    );
    expect(validateValueDraft('THRESHOLD', draft({ thresholdValue: '10' }))).toBe(
      'playbook.errors.unitRequired',
    );
  });

  it('accepts a THRESHOLD value of 0 (not treated as missing)', () => {
    expect(
      validateValueDraft(
        'THRESHOLD',
        draft({ thresholdValue: '0', unit: 'percent' }),
      ),
    ).toBeNull();
  });

  it('validates ENUM', () => {
    expect(validateValueDraft('ENUM', draft({ allowed: 'ICC\nLCIA' }))).toBeNull();
    expect(validateValueDraft('ENUM', draft({ allowed: '   \n  ' }))).toBe(
      'playbook.errors.allowedRequired',
    );
    expect(
      validateValueDraft(
        'ENUM',
        draft({ allowed: Array.from({ length: 51 }, (_, i) => `e${i}`).join('\n') }),
      ),
    ).toBe('playbook.errors.allowedTooMany');
    expect(
      validateValueDraft('ENUM', draft({ allowed: 'x'.repeat(201) })),
    ).toBe('playbook.errors.allowedEntryTooLong');
  });

  it('accepts REQUIRED with no input at all', () => {
    expect(validateValueDraft('REQUIRED', draft())).toBeNull();
  });

  it('validates TEXT', () => {
    expect(validateValueDraft('TEXT', draft({ text: 'Our standard' }))).toBeNull();
    expect(validateValueDraft('TEXT', draft({ text: '   ' }))).toBe(
      'playbook.errors.textRequired',
    );
    expect(validateValueDraft('TEXT', draft({ text: 'x'.repeat(5001) }))).toBe(
      'playbook.errors.textTooLong',
    );
  });
});

// ─── Draft → value_config ─────────────────────────────────────────────────────

describe('buildValueConfig', () => {
  it('emits ONLY the keys the backend allows for each rule type', () => {
    // The backend rejects unknown keys outright, so an extra key is a 400.
    expect(
      Object.keys(
        buildValueConfig('RANGE', draft({ min: '28', max: '45', unit: 'days' })),
      ).sort(),
    ).toEqual(['max', 'min', 'unit']);
    expect(
      Object.keys(
        buildValueConfig(
          'THRESHOLD',
          draft({ thresholdValue: '10', unit: 'percent' }),
        ),
      ).sort(),
    ).toEqual(['direction', 'unit', 'value']);
    expect(
      Object.keys(buildValueConfig('ENUM', draft({ allowed: 'ICC' }))),
    ).toEqual(['allowed']);
    expect(Object.keys(buildValueConfig('REQUIRED', draft()))).toEqual(['required']);
    expect(Object.keys(buildValueConfig('TEXT', draft({ text: 'a' })))).toEqual([
      'text',
    ]);
  });

  it('coerces numbers to real numbers, not strings', () => {
    const cfg = buildValueConfig(
      'RANGE',
      draft({ min: ' 28 ', max: '45', unit: ' days ' }),
    ) as { min: number; max: number; unit: string };
    expect(cfg.min).toBe(28);
    expect(cfg.max).toBe(45);
    expect(typeof cfg.min).toBe('number');
    expect(cfg.unit).toBe('days');
  });

  it('emits REQUIRED as literal true', () => {
    expect(buildValueConfig('REQUIRED', draft())).toEqual({ required: true });
  });

  it('trims ENUM entries and drops blank lines', () => {
    expect(
      buildValueConfig('ENUM', draft({ allowed: ' ICC \n\n  LCIA\n \n' })),
    ).toEqual({ allowed: ['ICC', 'LCIA'] });
  });

  it('round-trips a position through draftFromPosition → buildValueConfig', () => {
    for (const p of [
      position({ rule_type: 'RANGE', value_config: { min: 28, max: 45, unit: 'days' } }),
      position({
        rule_type: 'THRESHOLD',
        value_config: { direction: 'AT_LEAST', value: 100, unit: 'percent' },
      }),
      position({ rule_type: 'ENUM', value_config: { allowed: ['ICC', 'LCIA'] } }),
      position({ rule_type: 'REQUIRED', value_config: { required: true } }),
      position({ rule_type: 'TEXT', value_config: { text: 'الدفع خلال 30 يوماً' } }),
    ]) {
      expect(buildValueConfig(p.rule_type, draftFromPosition(p))).toEqual(
        p.value_config,
      );
    }
  });
});

describe('parseAllowedList', () => {
  it('trims, drops blanks, and preserves order', () => {
    expect(parseAllowedList('  b \n\n a \n')).toEqual(['b', 'a']);
  });
  it('returns [] for an empty string', () => {
    expect(parseAllowedList('')).toEqual([]);
  });
});

describe('constants', () => {
  it('has a badge class for every rule type', () => {
    expect(Object.keys(RULE_TYPE_BADGE).sort()).toEqual([...RULE_TYPES].sort());
  });
  it('exposes the five rule types', () => {
    expect(RULE_TYPES).toHaveLength(5);
  });
});
