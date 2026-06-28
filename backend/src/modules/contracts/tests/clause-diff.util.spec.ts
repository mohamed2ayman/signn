import {
  computeClauseDiff,
  ClauseDiffInput,
} from '../utils/clause-diff.util';

/**
 * Guest version review — Sub-slice 2b. Unit proof of the extracted diff
 * algorithm (no Postgres). Covers:
 *  - default clause_id matching → the EXACT behavior compareVersions had before
 *    the extraction (ADDED / REMOVED / MODIFIED word-level / UNCHANGED, sort);
 *  - section_number matching → proposed-vs-current pairs clauses that have NEW
 *    clause_ids but the same article number.
 */
const c = (
  clause_id: string,
  clause_title: string,
  clause_content: string,
  section_number: string | null = null,
): ClauseDiffInput => ({ clause_id, clause_title, clause_content, section_number });

describe('computeClauseDiff', () => {
  describe('default (clause_id) matching — version-vs-version behavior', () => {
    it('MODIFIED: same id, changed content → word-level diff flags the change', () => {
      const r = computeClauseDiff(
        [c('c1', 'T', 'hello world')],
        [c('c1', 'T', 'hello brave world')],
      );
      expect(r.summary).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 0 });
      const ch = r.changes[0];
      expect(ch.changeType).toBe('MODIFIED');
      expect(ch.clauseId).toBe('c1');
      expect(ch.originalText).toBe('hello world');
      expect(ch.newText).toBe('hello brave world');
      // The added word is flagged added; nothing removed.
      expect(ch.wordLevelDiff!.some((p) => p.added && p.value.includes('brave'))).toBe(true);
      expect(ch.wordLevelDiff!.some((p) => p.removed)).toBe(false);
    });

    it('ADDED / REMOVED / UNCHANGED + changed-first sort', () => {
      const r = computeClauseDiff(
        [c('keep', 'K', 'same'), c('gone', 'G', 'bye')],
        [c('keep', 'K', 'same'), c('new', 'N', 'hi')],
      );
      expect(r.summary).toEqual({ added: 1, removed: 1, modified: 0, unchanged: 1 });
      // Changed (ADDED, REMOVED) sort before UNCHANGED.
      expect(r.changes[r.changes.length - 1].changeType).toBe('UNCHANGED');
      const added = r.changes.find((x) => x.changeType === 'ADDED')!;
      expect(added.clauseId).toBe('new');
      expect(added.originalText).toBeNull();
      expect(added.newText).toBe('hi');
      const removed = r.changes.find((x) => x.changeType === 'REMOVED')!;
      expect(removed.clauseId).toBe('gone');
      expect(removed.newText).toBeNull();
      expect(removed.originalText).toBe('bye');
    });
  });

  describe('section_number matching — proposed-vs-current', () => {
    const sectionKeyOf = (x: ClauseDiffInput) =>
      x.section_number && x.section_number.trim()
        ? `sec:${x.section_number.trim()}`
        : `nokey:${x.clause_id}`;

    it('pairs a proposed clause (NEW id) to the original by section_number → MODIFIED', () => {
      const r = computeClauseDiff(
        [c('orig-id', 'Payment', 'pay within 30 days', '5')], // current live
        [c('prop-id', 'Payment', 'pay within 45 days', '5')], // proposed (different id, same §5)
        sectionKeyOf,
      );
      expect(r.summary).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 0 });
      expect(r.changes[0].changeType).toBe('MODIFIED');
      expect(r.changes[0].clauseNumber).toBe('5');
      expect(r.changes[0].wordLevelDiff!.some((p) => p.added && p.value.includes('45'))).toBe(true);
      expect(r.changes[0].wordLevelDiff!.some((p) => p.removed && p.value.includes('30'))).toBe(true);
    });

    it('different sections → ADDED + REMOVED; missing section_number → ADDED (unmatchable)', () => {
      const r = computeClauseDiff(
        [c('o1', 'A', 'orig', '1')],
        [c('p2', 'B', 'brand new', '2'), c('p3', 'C', 'no section', null)],
        sectionKeyOf,
      );
      expect(r.summary).toEqual({ added: 2, removed: 1, modified: 0, unchanged: 0 });
      expect(
        r.changes
          .filter((x) => x.changeType === 'ADDED')
          .map((x) => x.clauseNumber),
      ).toEqual(expect.arrayContaining(['2', null]));
      expect(r.changes.filter((x) => x.changeType === 'ADDED')).toHaveLength(2);
      expect(r.changes.find((x) => x.changeType === 'REMOVED')!.clauseNumber).toBe('1');
    });

    it('identical content under same section → UNCHANGED', () => {
      const r = computeClauseDiff(
        [c('o1', 'A', 'identical', '1')],
        [c('p1', 'A', 'identical', '1')],
        sectionKeyOf,
      );
      expect(r.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 1 });
    });

    it('empty proposed set → all current clauses REMOVED; both empty → empty diff', () => {
      const removedAll = computeClauseDiff([c('o1', 'A', 'x', '1')], [], sectionKeyOf);
      expect(removedAll.summary).toEqual({ added: 0, removed: 1, modified: 0, unchanged: 0 });
      const empty = computeClauseDiff([], [], sectionKeyOf);
      expect(empty.changes).toHaveLength(0);
      expect(empty.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 0 });
    });
  });
});
