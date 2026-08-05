import { describe, it, expect } from 'vitest';
import {
  resolveClassificationBadge,
  CLASSIFICATION_BADGE,
} from './playbookClassification';
import type { ComplianceFindingClassification } from '@/services/api/complianceService';

/**
 * 7.22 Slice B — the load-bearing assertions here are STRUCTURAL, not colour.
 * NON_STANDARD is a coverage gap ("add a position"), not a bigger deviation
 * ("negotiate"), so a regression that quietly turns it into a third colour on
 * the MINOR→MAJOR ramp must fail these tests.
 */
describe('resolveClassificationBadge', () => {
  describe('each classification resolves', () => {
    it.each<[ComplianceFindingClassification, string]>([
      ['MINOR', 'complianceTab.classification.MINOR'],
      ['MAJOR', 'complianceTab.classification.MAJOR'],
      ['NON_STANDARD', 'complianceTab.classification.NON_STANDARD'],
    ])('%s resolves with its own label key', (classification, labelKey) => {
      const badge = resolveClassificationBadge(classification);
      expect(badge).not.toBeNull();
      expect(badge!.classification).toBe(classification);
      expect(badge!.labelKey).toBe(labelKey);
      expect(badge!.className).toBeTruthy();
    });

    it('gives every classification a DISTINCT label key', () => {
      const keys = (['MINOR', 'MAJOR', 'NON_STANDARD'] as const).map(
        (c) => resolveClassificationBadge(c)!.labelKey,
      );
      expect(new Set(keys).size).toBe(3);
    });
  });

  describe('no classification → no badge', () => {
    it('returns null for null (non-PLAYBOOK finding — DB CHECK guarantees it)', () => {
      expect(resolveClassificationBadge(null)).toBeNull();
    });

    it('returns null for undefined (row predating PR #225)', () => {
      expect(resolveClassificationBadge(undefined)).toBeNull();
    });

    it('returns null for an unrecognised value from the untyped jsonb boundary', () => {
      expect(
        resolveClassificationBadge(
          'CATASTROPHIC' as ComplianceFindingClassification,
        ),
      ).toBeNull();
    });

    it('never substitutes a default classification', () => {
      // Guards the graceful-absence rule shared with the #216 pill.
      for (const absent of [null, undefined]) {
        expect(resolveClassificationBadge(absent)).toBeNull();
      }
    });
  });

  describe('MINOR and MAJOR are one ramp — same kind, same shape', () => {
    const minor = resolveClassificationBadge('MINOR')!;
    const major = resolveClassificationBadge('MAJOR')!;

    it('are both deviations, actioned by negotiating', () => {
      expect(minor.kind).toBe('deviation');
      expect(major.kind).toBe('deviation');
      expect(minor.hintKey).toBe(major.hintKey);
    });

    it('share the pill shape and the warning icon', () => {
      expect(minor.icon).toBe('warning');
      expect(major.icon).toBe('warning');
      expect(minor.className).toContain('rounded-full');
      expect(major.className).toContain('rounded-full');
    });

    it('differ from each other ONLY by colour weight', () => {
      expect(minor.className).toContain('bg-amber-100');
      expect(major.className).toContain('bg-orange-200');
      expect(minor.className).not.toBe(major.className);
    });

    it('never use the red the legal severity axis owns', () => {
      expect(minor.className).not.toMatch(/red/);
      expect(major.className).not.toMatch(/red/);
    });
  });

  describe('NON_STANDARD is a DIFFERENT KIND, not a third ramp colour', () => {
    const gap = resolveClassificationBadge('NON_STANDARD')!;
    const minor = resolveClassificationBadge('MINOR')!;
    const major = resolveClassificationBadge('MAJOR')!;

    it('is a coverage gap, not a deviation', () => {
      expect(gap.kind).toBe('gap');
      expect(gap.kind).not.toBe(minor.kind);
      expect(gap.kind).not.toBe(major.kind);
    });

    it('points at a DIFFERENT action from the deviations ("add", not "negotiate")', () => {
      expect(gap.hintKey).not.toBe(minor.hintKey);
      expect(gap.hintKey).not.toBe(major.hintKey);
      expect(gap.hintKey).toBe('complianceTab.classification.hint.gap');
    });

    it('uses an ADD icon, not the deviations’ warning icon', () => {
      expect(gap.icon).toBe('add');
      expect(gap.icon).not.toBe(minor.icon);
    });

    // ── The four structural differentiators ──────────────────────────────
    it('is NOT pill-shaped, unlike both deviations', () => {
      expect(gap.className).toContain('rounded-md');
      expect(gap.className).not.toContain('rounded-full');
    });

    it('is UNFILLED, unlike both deviations’ solid fills', () => {
      expect(gap.className).toContain('bg-transparent');
      expect(gap.className).not.toMatch(/bg-(amber|orange|yellow|red|emerald)-\d/);
    });

    it('carries a DASHED border, which neither deviation has', () => {
      expect(gap.className).toContain('border-dashed');
      expect(minor.className).not.toContain('border-dashed');
      expect(major.className).not.toContain('border-dashed');
    });

    it('is NOT on the amber→orange deviation ramp at all', () => {
      // The regression this whole block exists to catch.
      expect(gap.className).not.toMatch(/amber/);
      expect(gap.className).not.toMatch(/orange/);
      expect(gap.className).toMatch(/slate/);
    });

    it('differs from BOTH deviations on more than colour', () => {
      // Strip every colour utility; what remains must still differ, i.e. the
      // distinction survives even if someone recolours the ramp.
      const shapeOnly = (c: string) =>
        c
          .split(/\s+/)
          .filter((cls) => !/-(amber|orange|slate|red|emerald|yellow)-\d+$/.test(cls))
          .join(' ');
      expect(shapeOnly(gap.className)).not.toBe(shapeOnly(minor.className));
      expect(shapeOnly(gap.className)).not.toBe(shapeOnly(major.className));
      // ...while the two deviations remain structurally identical to each other.
      expect(shapeOnly(minor.className)).toBe(shapeOnly(major.className));
    });
  });

  describe('does not collide with the neighbouring chips', () => {
    it('avoids the #216 pill’s emerald, which means "on standard"', () => {
      for (const c of ['MINOR', 'MAJOR', 'NON_STANDARD'] as const) {
        expect(resolveClassificationBadge(c)!.className).not.toMatch(/emerald/);
      }
    });

    it('exposes a spec for every classification and no extras', () => {
      expect(Object.keys(CLASSIFICATION_BADGE).sort()).toEqual([
        'MAJOR',
        'MINOR',
        'NON_STANDARD',
      ]);
    });
  });
});
