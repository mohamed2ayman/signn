/**
 * Cover-page / TOC / preamble trimming for extracted contract text.
 *
 * Replaces the old label-driven `trimCoverPages` that silently deleted real
 * clauses: a Conditions document mislabeled "Contract Agreement" took the
 * agreement path and trimmed at the FIRST `تم الاتفاق` — which also appears
 * mid-body (e.g. "ما لم يتم الاتفاق على غير ذلك") — cutting `البند 1` etc.
 *
 * This implementation is LABEL-INDEPENDENT (the document_label is advisory only,
 * used in the warning message; the trim decision is content-driven) and applies:
 *
 *  - (B) A numbered clause-1 marker is authoritative and is NEVER trimmed away.
 *        Trim at the first clause marker, UNLESS a genuine agreement opening
 *        phrase precedes it (a true agreement's recitals / party block), in
 *        which case trim at the opening phrase so the preamble is kept.
 *  - (C) The bare `تم الاتفاق` marker is REMOVED. Only the specific opening
 *        phrases `إنه في يوم` and `تم الاتفاق بين كل من` are treated as preamble
 *        starts — they do not occur mid-body the way bare `تم الاتفاق` does.
 *  - (D) If an agreement opening phrase is found AT/AFTER the first clause
 *        marker, the old logic would have silently cut a clause. Instead we trim
 *        at the clause marker (preserving clause 1) AND surface this loudly: a
 *        `warning` string (for logging) plus the `cover_trim_clause_guard` flag.
 */

/** Quality flag recorded when the clause-guard prevents a clause-cutting trim. */
export const COVER_TRIM_CLAUSE_GUARD_FLAG = 'cover_trim_clause_guard';

/**
 * Numbered clause-1 markers. A numbered clause must NEVER be trimmed away — the
 * earliest of these is the authoritative "start of the contract body".
 */
const CLAUSE_MARKERS: RegExp[] = [
  // Arabic markers: line-anchored (^\s* + /m) so a mid-body cross-reference
  // (e.g. "…البند (2) من هذا العقد…") is NEVER treated as the trim point; accept
  // the optional رقم word and a space after the bracket ("البند رقم ( 1 )").
  // Mirrors the clause-extractor's _ARTICLE_BOUNDARY_RE intent.
  /^\s*مادة\s*(?:رقم\s*)?[\(\[]?\s*[١-٩\d]/m, // مادة (1) / مادة رقم ( 1 ) / مادة 1
  /^\s*المادة\s*(?:رقم\s*)?[\(\[]?\s*[١-٩\d]/m, // المادة (1) / المادة رقم (1)
  /^\s*البند\s*(?:رقم\s*)?[\(\[]?\s*[١-٩\d]/m, // البند (1) / البند رقم ( 1 ) / البند 1
  /Article\s*1\b/i,
  /Clause\s*1\b/i,
  /^1[-–.]/m,
];

/**
 * Agreement OPENING phrases only. The bare `تم الاتفاق` was deliberately dropped
 * (C) — it is a substring of common body phrases and silently truncated real
 * clauses. These two are genuine preamble openers.
 */
const AGREEMENT_OPENINGS: RegExp[] = [/إنه في يوم/, /تم الاتفاق بين كل من/];

/** Earliest match index across the given patterns, or -1 if none match. */
function firstMatchIndex(text: string, patterns: RegExp[]): number {
  let best = -1;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.index !== undefined && (best === -1 || match.index < best)) {
      best = match.index;
    }
  }
  return best;
}

export interface CoverTrimResult {
  /** The trimmed text (never has a numbered clause-1 cut from the front). */
  text: string;
  /** Observability flags (e.g. the clause-guard flag) — never blocks pipeline. */
  flags: string[];
  /** Loud warning to log when the clause-guard fired, else null. */
  warning: string | null;
}

export function computeCoverTrim(
  text: string,
  documentLabel?: string | null,
): CoverTrimResult {
  if (!text) return { text, flags: [], warning: null };

  const clauseIdx = firstMatchIndex(text, CLAUSE_MARKERS);
  const agreementIdx = firstMatchIndex(text, AGREEMENT_OPENINGS);

  // (B) A numbered clause exists — it is authoritative; never trim past it.
  if (clauseIdx >= 0) {
    // A genuine preamble (agreement opener) that sits BEFORE clause 1 → keep it
    // (true-agreement recitals / party block).
    if (agreementIdx >= 0 && agreementIdx < clauseIdx) {
      return { text: text.substring(agreementIdx), flags: [], warning: null };
    }

    // (D) An agreement opener exists but AT/AFTER clause 1 → the old logic would
    // have cut a clause. Trim at the clause marker instead, and make it loud.
    if (agreementIdx >= 0) {
      return {
        text: text.substring(clauseIdx),
        flags: [COVER_TRIM_CLAUSE_GUARD_FLAG],
        warning:
          `cover-trim clause-guard: an agreement opening phrase at index ` +
          `${agreementIdx} occurs at/after the first numbered clause marker ` +
          `(index ${clauseIdx}); trimmed at the clause marker to preserve ` +
          `clause 1 instead of silently cutting it. document_label=` +
          `"${documentLabel ?? ''}"`,
      };
    }

    // Normal case: trim cover page / TOC down to the first numbered clause.
    return { text: text.substring(clauseIdx), flags: [], warning: null };
  }

  // No numbered clause anywhere → safe to trim at the preamble opener if present.
  if (agreementIdx >= 0) {
    return { text: text.substring(agreementIdx), flags: [], warning: null };
  }

  // Nothing to trim.
  return { text, flags: [], warning: null };
}
