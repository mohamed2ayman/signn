/**
 * Snapshot-once clause-CONTENT correction tracking (scan-corruption guard — Fix #3).
 *
 * Called from EVERY path where a human can change a clause's content (the clause-library
 * update + the review-edit flow). On a REAL change it preserves the pre-edit content as
 * the AI-original (only if not already snapshotted — never overwrites the AI's first
 * text) and flags the human edit; a no-op change (same value) flips nothing. This is the
 * verbatim analogue of `applyClauseTypeEdit` (clause-type-correction.util.ts) applied to
 * CONTENT, so a silently OCR-reconstructed clause is auditable (AI-extracted vs human-fixed).
 *
 * Pure + mutating on the passed clause object so both service paths stay DRY and the
 * logic is unit-tested in isolation.
 */
export interface ClauseContentEditable {
  content: string;
  original_ai_content?: string | null;
  is_content_edited_by_user?: boolean;
}

export function applyClauseContentEdit(
  clause: ClauseContentEditable,
  newContent: string,
): void {
  if (newContent === clause.content) {
    return; // no-op — do NOT flip the correction flag or touch the snapshot
  }
  if (!clause.original_ai_content) {
    // snapshot the pre-edit content once (the AI's raw extraction for clauses written
    // with the Fix #3 seam; best-effort pre-edit value for older rows)
    clause.original_ai_content = clause.content ?? null;
  }
  clause.is_content_edited_by_user = true;
  clause.content = newContent;
}
