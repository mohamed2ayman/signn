/**
 * Snapshot-once clause-type correction tracking (Step 2 — retrain logging).
 *
 * Called from EVERY path where a human can change a clause's type (the clause-library
 * update + the review-edit flow). On a REAL change it preserves the pre-edit type as
 * the AI-original (only if not already snapshotted — never overwrites the AI's first
 * label) and flags the human edit; a no-op change (same value) flips nothing. Mirrors
 * the risk-annotation pattern (risk_analyses.is_edited_by_user + original_risk_category).
 *
 * Pure + mutating on the passed clause object so both service paths stay DRY and the
 * logic is unit-tested in isolation.
 */
export interface ClauseTypeEditable {
  clause_type: string | null;
  original_ai_clause_type?: string | null;
  is_type_edited_by_user?: boolean;
}

export function applyClauseTypeEdit(clause: ClauseTypeEditable, newType: string): void {
  if (newType === clause.clause_type) {
    return; // no-op — do NOT flip the correction flag or touch the snapshot
  }
  if (!clause.original_ai_clause_type) {
    // snapshot the pre-edit type once (the AI's original for clauses written after
    // the provider seam; best-effort pre-edit value for older rows)
    clause.original_ai_clause_type = clause.clause_type ?? null;
  }
  clause.is_type_edited_by_user = true;
  clause.clause_type = newType;
}
