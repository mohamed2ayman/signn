import { describe, it, expect } from 'vitest';
import { resolvePlaybookCoverage, playbookCoverageKey } from './playbookCoverage';

/**
 * 7.22 Slice A — first tests for the playbook-coverage stat. ComplianceTab.tsx
 * has no test file, which is exactly why this logic lives in a pure module.
 */
describe('resolvePlaybookCoverage', () => {
  describe('M and N present — the normal path', () => {
    it('returns the counts for a partially-deviated playbook', () => {
      expect(resolvePlaybookCoverage(5, 3)).toEqual({
        kind: 'counts',
        onStandard: 3,
        relevant: 5,
      });
    });

    it('handles a fully on-standard playbook (N === M)', () => {
      expect(resolvePlaybookCoverage(5, 5)).toEqual({
        kind: 'counts',
        onStandard: 5,
        relevant: 5,
      });
    });

    it('handles nothing on standard (N === 0) — a real, renderable state', () => {
      // Distinct from the absent case below: 0-of-4 is TRUE and must render.
      expect(resolvePlaybookCoverage(4, 0)).toEqual({
        kind: 'counts',
        onStandard: 0,
        relevant: 4,
      });
    });
  });

  describe('M absent — render nothing', () => {
    it.each([
      ['undefined (legacy row predating PR #225)', undefined],
      ['null', null],
    ])('returns null when M is %s', (_label, m) => {
      expect(resolvePlaybookCoverage(m as undefined | null, 3)).toBeNull();
    });

    it('returns null when BOTH are absent (the FAILED branch writes only `error`)', () => {
      expect(resolvePlaybookCoverage(undefined, undefined)).toBeNull();
    });
  });

  describe('M === 0 — no playbook positions apply', () => {
    it('returns the noPositions state', () => {
      expect(resolvePlaybookCoverage(0, 0)).toEqual({ kind: 'noPositions' });
    });

    it('returns noPositions regardless of N, since N is meaningless at M=0', () => {
      expect(resolvePlaybookCoverage(0, undefined)).toEqual({ kind: 'noPositions' });
    });

    it('is NOT the same as absent — M=0 renders, M=undefined does not', () => {
      // Guards the reason this state exists: the #216 pill shows a green
      // "On standard" when no playbook ran, and this contradicts it.
      expect(resolvePlaybookCoverage(0, 0)).not.toBeNull();
      expect(resolvePlaybookCoverage(undefined, 0)).toBeNull();
    });
  });

  describe('incoherent data — never render a misleading number', () => {
    it('returns null when M > 0 but N is absent (never defaults N to 0)', () => {
      // Defaulting would claim "0 of 5 on standard" — actively false.
      expect(resolvePlaybookCoverage(5, undefined)).toBeNull();
      expect(resolvePlaybookCoverage(5, null)).toBeNull();
    });

    it('returns null when N exceeds M', () => {
      expect(resolvePlaybookCoverage(3, 4)).toBeNull();
    });

    it.each([
      ['negative M', -1, 2],
      ['negative N', 5, -1],
      ['fractional M', 2.5, 1],
      ['fractional N', 5, 1.5],
      ['NaN M', Number.NaN, 1],
      ['NaN N', 5, Number.NaN],
      ['Infinity M', Number.POSITIVE_INFINITY, 1],
    ])('returns null for %s', (_label, m, n) => {
      expect(resolvePlaybookCoverage(m, n)).toBeNull();
    });

    it('returns null for non-numeric values coming from untyped jsonb', () => {
      // findings_summary is jsonb — the type is a claim, not a guarantee.
      expect(
        resolvePlaybookCoverage('5' as unknown as number, '3' as unknown as number),
      ).toBeNull();
    });
  });
});

describe('playbookCoverageKey', () => {
  it('maps the counts state to the N-of-M key', () => {
    expect(playbookCoverageKey({ kind: 'counts', onStandard: 3, relevant: 5 })).toBe(
      'complianceTab.playbookCoverage.onStandard',
    );
  });

  it('maps the empty state to the no-positions key', () => {
    expect(playbookCoverageKey({ kind: 'noPositions' })).toBe(
      'complianceTab.playbookCoverage.noPositions',
    );
  });
});
