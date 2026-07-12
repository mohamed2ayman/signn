import {
  computeDefaultVisibleIds,
  resolveVisibleIds,
  severityRank,
} from '../risk-visibility.util';

const r = (id: string, level: string | null, description = id) => ({
  id,
  risk_level: level,
  description,
});

describe('risk-visibility.util — default top-2 (severity + distinct)', () => {
  it('ranks severity HIGH > MEDIUM > LOW', () => {
    expect(severityRank('HIGH')).toBeGreaterThan(severityRank('MEDIUM'));
    expect(severityRank('MEDIUM')).toBeGreaterThan(severityRank('LOW'));
    expect(severityRank(null)).toBe(0);
    expect(severityRank('WEIRD')).toBe(0); // unknown → last
  });

  it('keeps the two highest severities', () => {
    const ids = computeDefaultVisibleIds([
      r('a', 'LOW'),
      r('b', 'HIGH'),
      r('c', 'MEDIUM'),
      r('d', 'HIGH'),
    ]);
    expect(ids).toEqual(['b', 'd']); // both HIGH, in input order
  });

  it('null/unknown severity sorts LAST', () => {
    const ids = computeDefaultVisibleIds([
      r('a', null),
      r('b', 'LOW'),
      r('c', 'MEDIUM'),
    ]);
    expect(ids).toEqual(['c', 'b']); // MEDIUM then LOW; null never picked
  });

  it('distinct tiebreaker skips a near-duplicate within the same severity', () => {
    // Three MEDIUMs; a and b are near-identical (same 40-char prefix), c distinct.
    const dupText = 'the contractor bears unlimited liability for all losses whatsoever';
    const ids = computeDefaultVisibleIds([
      r('a', 'MEDIUM', dupText + ' (variant one)'),
      r('b', 'MEDIUM', dupText + ' (variant two)'),
      r('c', 'MEDIUM', 'a completely different payment-terms concern'),
    ]);
    expect(ids).toEqual(['a', 'c']); // b skipped as a near-dup of a
  });

  it('backfills when the distinct-skip would leave < 2 (clause with only near-dups still shows 2)', () => {
    const same = 'identical wording that repeats across the whole clause exactly';
    const ids = computeDefaultVisibleIds([
      r('a', 'MEDIUM', same),
      r('b', 'MEDIUM', same),
      r('c', 'MEDIUM', same),
    ]);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(['a', 'b']); // a picked, b backfilled despite being a dup
  });
});

describe('risk-visibility.util — resolveVisibleIds (swap override)', () => {
  const risks = [r('a', 'HIGH'), r('b', 'HIGH'), r('c', 'MEDIUM'), r('d', 'LOW')];

  it('a valid 2-id override wins over the default', () => {
    expect(resolveVisibleIds(risks, ['c', 'd'])).toEqual(['c', 'd']);
  });

  it('no override → deterministic default', () => {
    expect(resolveVisibleIds(risks, null)).toEqual(['a', 'b']);
  });

  it('a stale override id is dropped and backfilled from the default', () => {
    // 'zzz' no longer exists; keep 'c', fill the 2nd from default (a).
    expect(resolveVisibleIds(risks, ['c', 'zzz'])).toEqual(['c', 'a']);
  });
});
