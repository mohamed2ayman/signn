import { describe, it, expect } from 'vitest';
import {
  coalesceWordDiffToWholeWords,
  countEditGroups,
  type DiffSeg,
} from './wordDiff';

// Reconstruction invariant helpers — the A-side (original) is every non-added
// value; the B-side (new) is every non-removed value. The coalesce must NEVER
// change either reconstruction.
const aSide = (segs: DiffSeg[]) => segs.filter((s) => !s.added).map((s) => s.value).join('');
const bSide = (segs: DiffSeg[]) => segs.filter((s) => !s.removed).map((s) => s.value).join('');

describe('coalesceWordDiffToWholeWords', () => {
  it('returns null/empty unchanged', () => {
    expect(coalesceWordDiffToWholeWords(null)).toBeNull();
    expect(coalesceWordDiffToWholeWords(undefined)).toBeNull();
    expect(coalesceWordDiffToWholeWords([])).toEqual([]);
  });

  it('Latin whole-word diff is a visual no-op (preserves reconstruction)', () => {
    // jsdiff already emits whole-word Latin tokens.
    const input: DiffSeg[] = [
      { value: 'Payment within ' },
      { value: '30', removed: true },
      { value: '45', added: true },
      { value: ' days of approval.' },
    ];
    const out = coalesceWordDiffToWholeWords(input)!;
    expect(aSide(out)).toBe('Payment within 30 days of approval.');
    expect(bSide(out)).toBe('Payment within 45 days of approval.');
    // 30 stays a removed token, 45 an added token — no extra speckle.
    expect(out.some((s) => s.removed && s.value.includes('30'))).toBe(true);
    expect(out.some((s) => s.added && s.value.includes('45'))).toBe(true);
  });

  it('Arabic sub-word speckle is merged into whole words', () => {
    // Simulate jsdiff splitting an Arabic word into a shared prefix + a changed
    // suffix: المقاول -> المقاولون (suffix added). Speckled input:
    const input: DiffSeg[] = [
      { value: 'يلتزم ' },
      { value: 'المقاول' }, // shared stem (unchanged)
      { value: 'ون', added: true }, // suffix only (speckle)
      { value: ' بذلك.' },
    ];
    const out = coalesceWordDiffToWholeWords(input)!;
    // Reconstruction preserved.
    expect(aSide(out)).toBe('يلتزم المقاول بذلك.');
    expect(bSide(out)).toBe('يلتزم المقاولون بذلك.');
    // The whole word is now one highlighted token on each side, not a fragment.
    expect(out.some((s) => s.added && s.value === 'المقاولون')).toBe(true);
    expect(out.some((s) => s.removed && s.value === 'المقاول')).toBe(true);
    // The shared stem is NOT left as a standalone unchanged fragment glued to
    // the highlight (no speckle): there is no unchanged "المقاول" segment.
    expect(out.some((s) => !s.added && !s.removed && s.value === 'المقاول')).toBe(false);
  });

  it('mid-word character change becomes a whole-word replace', () => {
    // ثلاثين -> أربعين split per-character by jsdiff.
    const input: DiffSeg[] = [
      { value: 'خلال ' },
      { value: 'ثلاث', removed: true },
      { value: 'أربع', added: true },
      { value: 'ين' }, // shared suffix
      { value: ' يوماً' },
    ];
    const out = coalesceWordDiffToWholeWords(input)!;
    expect(aSide(out)).toBe('خلال ثلاثين يوماً');
    expect(bSide(out)).toBe('خلال أربعين يوماً');
    expect(out.some((s) => s.removed && s.value === 'ثلاثين')).toBe(true);
    expect(out.some((s) => s.added && s.value === 'أربعين')).toBe(true);
  });

  it('pure addition (new clause) keeps only an added segment', () => {
    const input: DiffSeg[] = [{ value: 'بند جديد كامل', added: true }];
    const out = coalesceWordDiffToWholeWords(input)!;
    expect(aSide(out)).toBe('');
    expect(bSide(out)).toBe('بند جديد كامل');
    expect(out.every((s) => s.added)).toBe(true);
  });

  it('pure removal keeps only removed segments', () => {
    const input: DiffSeg[] = [{ value: 'بند محذوف', removed: true }];
    const out = coalesceWordDiffToWholeWords(input)!;
    expect(aSide(out)).toBe('بند محذوف');
    expect(bSide(out)).toBe('');
    expect(out.every((s) => s.removed)).toBe(true);
  });

  it('whitespace is preserved exactly (newlines, multiple spaces)', () => {
    const input: DiffSeg[] = [
      { value: 'أ' },
      { value: '\n\n  ' },
      { value: 'ب', removed: true },
      { value: 'ج', added: true },
    ];
    const out = coalesceWordDiffToWholeWords(input)!;
    expect(aSide(out)).toBe('أ\n\n  ب');
    expect(bSide(out)).toBe('أ\n\n  ج');
  });
});

describe('countEditGroups', () => {
  it('counts contiguous edit runs', () => {
    expect(
      countEditGroups([
        { value: 'a ' },
        { value: 'b', removed: true },
        { value: 'c', added: true },
        { value: ' d ' },
        { value: 'e', added: true },
      ]),
    ).toBe(2);
    expect(countEditGroups([{ value: 'all unchanged' }])).toBe(0);
    expect(countEditGroups(null)).toBe(0);
  });
});
