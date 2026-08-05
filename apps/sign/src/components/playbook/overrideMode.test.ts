import { describe, it, expect } from 'vitest';
import {
  resolveOverrideMode,
  showsSubjectSelect,
  type OverrideFinding,
} from './overrideMode';
import type { PlaybookPosition } from '@/services/api/playbookService';

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

function finding(over: Partial<OverrideFinding> = {}): OverrideFinding {
  return {
    requirement: 'Payment terms exceed the org standard',
    clause_ref: '14.7',
    layer: 'PLAYBOOK',
    playbook_position_id: null,
    classification: 'MINOR',
    ...over,
  };
}

describe('resolveOverrideMode', () => {
  describe('case 1 — auto-link (position id present and resolvable)', () => {
    it('links to the position the deviation is against', () => {
      const p = position({ id: 'pos-9', clause_type: 'liability' });
      const mode = resolveOverrideMode(
        finding({ playbook_position_id: 'pos-9' }),
        [position({ id: 'other' }), p],
      );
      expect(mode).toEqual({ kind: 'linked', position: p });
    });

    it('links even when the position is INACTIVE (list() returns inactive rows)', () => {
      const p = position({ id: 'pos-9', is_active: false });
      const mode = resolveOverrideMode(
        finding({ playbook_position_id: 'pos-9' }),
        [p],
      );
      expect(mode).toEqual({ kind: 'linked', position: p });
    });

    it('links regardless of classification — the id is what matters', () => {
      const p = position({ id: 'pos-9' });
      for (const c of ['MINOR', 'MAJOR'] as const) {
        expect(
          resolveOverrideMode(
            finding({ playbook_position_id: 'pos-9', classification: c }),
            [p],
          ),
        ).toEqual({ kind: 'linked', position: p });
      }
    });

    it('a RESOLVABLE id beats a NON_STANDARD classification', () => {
      // Shouldn't co-occur — the agent defines NON_STANDARD as "a clause type
      // with NO listed structured position". If it does anyway, the id is the
      // stronger signal: it is server-validated against real positions, so
      // linking to the position beats telling the user to add one that exists.
      const p = position({ id: 'pos-9' });
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'pos-9', classification: 'NON_STANDARD' }),
          [p],
        ),
      ).toEqual({ kind: 'linked', position: p });
    });

    it('an empty-string id is treated as absent, not as a lookup', () => {
      // The backend nulls any echoed id that is not in validPositionIds, so ''
      // never persists — this pins the defensive behaviour if one ever leaked.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: '', classification: 'NON_STANDARD' }),
          [],
        ),
      ).toEqual({ kind: 'addPosition' });
    });
  });

  describe('async-timing guard', () => {
    it('waits instead of deciding while positions are still loading', () => {
      // The flash this prevents: manual picker for one frame, then linked.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'pos-9' }),
          undefined,
        ),
      ).toEqual({ kind: 'loading' });
    });

    it('resolves once the positions arrive', () => {
      const f = finding({ playbook_position_id: 'pos-9' });
      expect(resolveOverrideMode(f, undefined).kind).toBe('loading');
      expect(resolveOverrideMode(f, [position({ id: 'pos-9' })]).kind).toBe('linked');
    });

    it('NEVER waits when there is no id to resolve — no needless spinner', () => {
      // Every other case is decided from the finding alone.
      expect(resolveOverrideMode(finding({ classification: 'MINOR' }), undefined).kind).toBe('manual');
      expect(resolveOverrideMode(finding({ classification: 'NON_STANDARD' }), undefined).kind).toBe('addPosition');
      expect(resolveOverrideMode(finding({ layer: 'STANDARD' }), undefined).kind).toBe('manual');
    });

    it('an empty loaded list is NOT the same as not-loaded', () => {
      const f = finding({ playbook_position_id: 'pos-9' });
      expect(resolveOverrideMode(f, undefined).kind).toBe('loading');
      expect(resolveOverrideMode(f, []).kind).toBe('manual');
    });
  });


  describe('a FAILED load degrades to the picker — never an endless spinner', () => {
    it('returns manual when the positions request errored', () => {
      // React Query leaves data undefined forever after a rejection. Treating
      // that as "loading" hides the subject field while Save still demands one.
      expect(
        resolveOverrideMode(finding({ playbook_position_id: 'pos-9' }), undefined, {
          isError: true,
        }),
      ).toEqual({ kind: 'manual' });
    });

    it('prefers the error degrade over waiting, even mid-fetch (retry in flight)', () => {
      expect(
        resolveOverrideMode(finding({ playbook_position_id: 'pos-9' }), undefined, {
          isError: true,
          isFetching: true,
        }).kind,
      ).toBe('manual');
    });

    it('still links if the data is somehow present despite an error flag', () => {
      const p = position({ id: 'pos-9' });
      expect(
        resolveOverrideMode(finding({ playbook_position_id: 'pos-9' }), [p], {
          isError: true,
        }),
      ).toEqual({ kind: 'linked', position: p });
    });
  });

  describe('a STALE cache being refetched waits instead of flashing the picker', () => {
    it('returns loading when the id is absent but a refetch is in flight', () => {
      // The warm-but-stale case: data is present and lacks the id, but the
      // refetch may still bring it. Showing the picker here lets the user pick
      // a subject that adoption would then overwrite.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'pos-9' }),
          [position({ id: 'other' })],
          { isFetching: true },
        ),
      ).toEqual({ kind: 'loading' });
    });

    it('falls back to manual once the refetch SETTLES without the position', () => {
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'pos-9' }),
          [position({ id: 'other' })],
          { isFetching: false },
        ),
      ).toEqual({ kind: 'manual' });
    });

    it('omitting the status means settled-and-fine (plain unit-test default)', () => {
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'pos-9' }),
          [position({ id: 'other' })],
        ).kind,
      ).toBe('manual');
    });
  });

  describe('case 2 vs case 3 — the distinction the helper exists for', () => {
    it('case 2: NON_STANDARD with no id → ADD a position', () => {
      // No position ever covered this clause type.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: null, classification: 'NON_STANDARD' }),
          [],
        ),
      ).toEqual({ kind: 'addPosition' });
    });

    it.each(['MINOR', 'MAJOR'] as const)(
      'case 3: %s with no id (position deleted) → manual picker',
      (classification) => {
        expect(
          resolveOverrideMode(
            finding({ playbook_position_id: null, classification }),
            [],
          ),
        ).toEqual({ kind: 'manual' });
      },
    );

    it('the NULL ID ALONE cannot separate them — classification does', () => {
      // Both have playbook_position_id === null; only classification differs,
      // and they must reach DIFFERENT modes.
      const gap = finding({ playbook_position_id: null, classification: 'NON_STANDARD' });
      const deleted = finding({ playbook_position_id: null, classification: 'MAJOR' });
      expect(gap.playbook_position_id).toBe(deleted.playbook_position_id);
      expect(resolveOverrideMode(gap, []).kind).not.toBe(
        resolveOverrideMode(deleted, []).kind,
      );
    });

    it('a null classification with no id falls back to the picker, never to add', () => {
      // Pre-#225 rows and coerceEnumOrNull misses must not be read as gaps.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: null, classification: null }),
          [],
        ),
      ).toEqual({ kind: 'manual' });
    });
  });

  describe('case 4 — non-PLAYBOOK layers', () => {
    it.each(['STANDARD', 'JURISDICTION', 'CONFLICT'] as const)(
      '%s → manual, exactly as before #214',
      (layer) => {
        expect(
          resolveOverrideMode(finding({ layer, classification: null }), []),
        ).toEqual({ kind: 'manual' });
      },
    );

    it('never links a non-PLAYBOOK finding even if an id somehow rode along', () => {
      // The DB CHECK makes this impossible; the guard is defence in depth.
      expect(
        resolveOverrideMode(
          finding({ layer: 'STANDARD', playbook_position_id: 'pos-9' }),
          [position({ id: 'pos-9' })],
        ),
      ).toEqual({ kind: 'manual' });
    });

    it('a null finding is manual, never a crash', () => {
      expect(resolveOverrideMode(null, [])).toEqual({ kind: 'manual' });
      expect(resolveOverrideMode(undefined, undefined)).toEqual({ kind: 'manual' });
    });
  });

  describe('unresolvable id degrades safely', () => {
    it('falls back to the picker when the id is not in the loaded list', () => {
      // Shouldn't occur (SET NULL clears dangling ids) — must not dead-end.
      expect(
        resolveOverrideMode(
          finding({ playbook_position_id: 'ghost' }),
          [position({ id: 'pos-9' })],
        ),
      ).toEqual({ kind: 'manual' });
    });
  });
});

describe('showsSubjectSelect', () => {
  it('hides the subject field only when the subject is already known', () => {
    expect(showsSubjectSelect({ kind: 'linked', position: position() })).toBe(false);
  });

  it('shows it for manual AND for addPosition', () => {
    // addPosition still needs a clause type: a position cannot be created
    // without one, and the finding carries clause_ref (a NUMBER), not a type.
    expect(showsSubjectSelect({ kind: 'manual' })).toBe(true);
    expect(showsSubjectSelect({ kind: 'addPosition' })).toBe(true);
  });

  it('hides it while loading, so no picker flashes before the linked view', () => {
    expect(showsSubjectSelect({ kind: 'loading' })).toBe(false);
  });
});
