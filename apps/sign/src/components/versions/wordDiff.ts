/**
 * Guest version review — Sub-slice 2c. Word-diff GRANULARITY tuning.
 *
 * The backend `computeClauseDiff` produces `wordLevelDiff` via jsdiff's
 * `diffWordsWithSpace`. For Latin text jsdiff tokenises on whole words, so the
 * highlights already land on whole words. For ARABIC, jsdiff falls back to a
 * near-character granularity, so a single changed word gets "speckled" —
 * fragments of a word are highlighted while the rest of the same word is not.
 *
 * This util is a RENDER-LAYER coalesce: it re-groups an existing
 * `wordLevelDiff` segment stream so every add/remove highlight is expanded to
 * the WHOLE whitespace-delimited word it touches. It NEVER changes the diff
 * data: the concatenation of the result's non-added values still equals the
 * original text, and of its non-removed values still equals the new text
 * (reconstruction invariant — unit-tested). The backend stays byte-identical,
 * so `compareVersions` (version-vs-version) is unaffected.
 *
 * For already-whole-word Latin input the coalesce is a visual no-op (it only
 * re-tokenises at whitespace, which Latin already respects), so the LTR
 * version-compare does not regress. For Arabic it merges the speckle into whole
 * words — matching the design's `{s,d,a}` whole-token highlight model.
 */
export interface DiffSeg {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** Split a string into alternating runs of non-whitespace and whitespace. */
function splitAtWhitespace(value: string): string[] {
  // Matches a maximal whitespace run OR a maximal non-whitespace run.
  const m = value.match(/\s+|\S+/g);
  return m ?? [];
}

const isWhitespace = (s: string): boolean => /^\s+$/.test(s);

interface Atom {
  value: string;
  added: boolean;
  removed: boolean;
  space: boolean;
}

/**
 * Re-group a word-level diff so highlights snap to whole whitespace-delimited
 * words. Whitespace runs are preserved as their own (separator) segments so the
 * reconstruction invariant holds exactly.
 */
export function coalesceWordDiffToWholeWords(
  segments: DiffSeg[] | null | undefined,
): DiffSeg[] | null {
  if (!segments) return null;
  if (segments.length === 0) return [];

  // 1) Explode every segment into whitespace-delimited atoms, carrying flags.
  const atoms: Atom[] = [];
  for (const seg of segments) {
    if (seg.value === '') continue;
    for (const run of splitAtWhitespace(seg.value)) {
      atoms.push({
        value: run,
        added: !!seg.added,
        removed: !!seg.removed,
        space: isWhitespace(run),
      });
    }
  }

  // 2) Walk the atoms; accumulate a word buffer of consecutive non-space atoms.
  //    A whitespace atom (or the end) flushes the buffer, then is emitted as-is.
  const out: DiffSeg[] = [];
  let wordBuf: Atom[] = [];

  const flush = () => {
    if (wordBuf.length === 0) return;
    const changed = wordBuf.some((a) => a.added || a.removed);
    if (!changed) {
      out.push({ value: wordBuf.map((a) => a.value).join('') });
    } else {
      // A-side (original) = unchanged + removed atoms; B-side (new) = unchanged + added.
      const aVal = wordBuf.filter((a) => !a.added).map((a) => a.value).join('');
      const bVal = wordBuf.filter((a) => !a.removed).map((a) => a.value).join('');
      if (aVal !== '') out.push({ value: aVal, removed: true });
      if (bVal !== '') out.push({ value: bVal, added: true });
    }
    wordBuf = [];
  };

  for (const atom of atoms) {
    if (atom.space) {
      flush();
      out.push(
        atom.added
          ? { value: atom.value, added: true }
          : atom.removed
            ? { value: atom.value, removed: true }
            : { value: atom.value },
      );
    } else {
      wordBuf.push(atom);
    }
  }
  flush();

  // 3) Merge adjacent segments of the same kind (keeps the DOM lean).
  const merged: DiffSeg[] = [];
  for (const seg of out) {
    const prev = merged[merged.length - 1];
    if (prev && !!prev.added === !!seg.added && !!prev.removed === !!seg.removed) {
      prev.value += seg.value;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/**
 * Count the distinct edit groups (runs of added/removed) in a coalesced diff —
 * used for the "N edits" badge in the host review screen.
 */
export function countEditGroups(segments: DiffSeg[] | null | undefined): number {
  if (!segments) return 0;
  let n = 0;
  let inEdit = false;
  for (const s of segments) {
    const edit = !!s.added || !!s.removed;
    if (edit && !inEdit) n++;
    inEdit = edit;
  }
  return n;
}
