/**
 * Phase 7.17 — Prompt 1, B.4.1 unit tests for computeMedian.
 *
 * Pure-function tests — no Nest, no DI, no DB. Covers odd / even count,
 * all-same, bimodal, single-element, ordering invariance, no-mutate,
 * and the empty-input throw.
 */

import { computeMedian } from '../median';

describe('computeMedian', () => {
  // ── Odd count — exact middle ─────────────────────────────────────
  it('returns the exact middle for odd-count input', () => {
    expect(computeMedian([1, 2, 3, 4, 5])).toBe(3);
  });

  // ── Even count — lower-midpoint (round-down) tie-break ───────────
  it('returns the LOWER midpoint for even-count input', () => {
    expect(computeMedian([2, 3])).toBe(2);
    expect(computeMedian([1, 2, 4, 5])).toBe(2); // lower of (2, 4)
  });

  // ── All same value ───────────────────────────────────────────────
  it('returns the common value when all inputs are identical', () => {
    expect(computeMedian([3, 3, 3, 3, 3])).toBe(3);
  });

  // ── Two distinct values (bimodal) ────────────────────────────────
  it('handles two-value bimodal samples (lower midpoint)', () => {
    expect(computeMedian([1, 1, 1, 5, 5, 5])).toBe(1); // lower of (1, 5)
  });

  // ── Single element ───────────────────────────────────────────────
  it('returns the single value for a 1-element array', () => {
    expect(computeMedian([4])).toBe(4);
  });

  // ── Ordering invariance ──────────────────────────────────────────
  it('does not depend on input ordering', () => {
    expect(computeMedian([5, 1, 3, 2, 4])).toBe(3);
    // 8 elements sorted: [1,1,2,3,4,5,6,9] → lower midpoint = index 3 = 3
    expect(computeMedian([3, 1, 4, 1, 5, 9, 2, 6])).toBe(3);
  });

  // ── Does not mutate the caller's array ───────────────────────────
  it('does not mutate the caller-supplied array', () => {
    const arr = [3, 1, 2];
    computeMedian(arr);
    expect(arr).toEqual([3, 1, 2]);
  });

  // ── Empty input throws ───────────────────────────────────────────
  it('throws on empty input', () => {
    expect(() => computeMedian([])).toThrow();
  });
});
