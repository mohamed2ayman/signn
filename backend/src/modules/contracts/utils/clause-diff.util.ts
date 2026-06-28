import { diffWordsWithSpace } from 'diff';

/**
 * Guest version review — Sub-slice 2b. The clause-diff ALGORITHM, extracted from
 * `ContractsService.compareVersions` so it can run over ANY two clause arrays —
 * not just contract_versions snapshot JSONB.
 *
 * Two consumers feed it different inputs:
 *   - version-vs-version compare (`compareVersions`) — snapshot clauses, matched
 *     by `clause_id` (the default keyOf), output byte-identical to pre-2b.
 *   - proposed-vs-current compare (`compareProposedVersion`) — LIVE clauses vs a
 *     guest's PROPOSED set, matched by `section_number` (proposed clauses carry
 *     NEW clause_ids, so clause_id matching would mark every clause add/remove).
 *
 * The output shape is exactly what the frontend `VersionComparisonResult.changes`
 * already consumes (no DiffViewer change needed for the data contract).
 */
export interface ClauseDiffInput {
  clause_id: string;
  clause_title: string;
  clause_content: string;
  section_number: string | null;
}

export interface ClauseDiffChange {
  clauseId: string;
  clauseNumber: string | null;
  clauseTitle: string;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
  originalText: string | null;
  newText: string | null;
  wordLevelDiff:
    | Array<{ value: string; added?: boolean; removed?: boolean }>
    | null;
}

export interface ClauseDiffResult {
  summary: { added: number; removed: number; modified: number; unchanged: number };
  changes: ClauseDiffChange[];
}

/**
 * Diff clause array A (the "previous"/original/current side) against array B
 * (the "next"/proposed side). Each clause is paired by `keyOf` (default
 * `clause_id`). A-only → REMOVED, B-only → ADDED, both → MODIFIED (word-level
 * diff) or UNCHANGED. Changed clauses sort first.
 */
export function computeClauseDiff(
  clausesA: ClauseDiffInput[],
  clausesB: ClauseDiffInput[],
  keyOf: (c: ClauseDiffInput) => string = (c) => c.clause_id,
): ClauseDiffResult {
  const aMap = new Map(clausesA.map((c) => [keyOf(c), c]));
  const bMap = new Map(clausesB.map((c) => [keyOf(c), c]));
  const allKeys = new Set<string>([...aMap.keys(), ...bMap.keys()]);

  const changes: ClauseDiffChange[] = [];
  let added = 0,
    removed = 0,
    modified = 0,
    unchanged = 0;

  for (const key of allKeys) {
    const a = aMap.get(key);
    const b = bMap.get(key);

    if (a && !b) {
      removed++;
      changes.push({
        clauseId: a.clause_id,
        clauseNumber: a.section_number,
        clauseTitle: a.clause_title,
        changeType: 'REMOVED',
        originalText: a.clause_content,
        newText: null,
        wordLevelDiff: null,
      });
    } else if (!a && b) {
      added++;
      changes.push({
        clauseId: b.clause_id,
        clauseNumber: b.section_number,
        clauseTitle: b.clause_title,
        changeType: 'ADDED',
        originalText: null,
        newText: b.clause_content,
        wordLevelDiff: null,
      });
    } else if (a && b) {
      const aText = a.clause_content || '';
      const bText = b.clause_content || '';
      if (aText === bText && a.clause_title === b.clause_title) {
        unchanged++;
        changes.push({
          clauseId: b.clause_id,
          clauseNumber: b.section_number,
          clauseTitle: b.clause_title,
          changeType: 'UNCHANGED',
          originalText: aText,
          newText: bText,
          wordLevelDiff: null,
        });
      } else {
        modified++;
        const wordDiff = diffWordsWithSpace(aText, bText).map((p) => ({
          value: p.value,
          added: p.added,
          removed: p.removed,
        }));
        changes.push({
          clauseId: b.clause_id,
          clauseNumber: b.section_number,
          clauseTitle: b.clause_title,
          changeType: 'MODIFIED',
          originalText: aText,
          newText: bText,
          wordLevelDiff: wordDiff,
        });
      }
    }
  }

  // Sort: changed first, then unchanged.
  const order: Record<string, number> = { ADDED: 0, REMOVED: 1, MODIFIED: 2, UNCHANGED: 3 };
  changes.sort((x, y) => order[x.changeType] - order[y.changeType]);

  return { summary: { added, removed, modified, unchanged }, changes };
}
