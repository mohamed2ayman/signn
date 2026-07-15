import type { ContractClause } from '@/types';

/**
 * The user-facing clause number shown on BOTH the Clauses tab and the Risk
 * Analysis tab.
 *
 * Rule: the stored `section_number` when present (e.g. "مادة (5)", "3"),
 * otherwise the clause's 1-based position in the shared server-side ordering
 * (document priority → upload order → order_index → id — the same order both
 * tabs consume, per PR #137).
 *
 * Keeping this derivation in ONE place is what guarantees the identical clause
 * shows the identical number on both tabs. It mirrors the Clauses-tab
 * expression `cc.section_number || index + 1` exactly (no trimming), so the
 * two surfaces can never drift.
 */
export function clauseDisplayNumber(
  cc: Pick<ContractClause, 'section_number'>,
  index: number,
): string {
  return cc.section_number || String(index + 1);
}

/**
 * Map `contract_clause_id → display number` over the FULL ordered clause list.
 *
 * The Risk tab only holds the risk-bearing clauses (a subset), so counting a
 * position within its own grouping would diverge from the Clauses tab whenever
 * a clause has no risks. Building the map from the full ordered `clauses` array
 * (the same array the Clauses tab maps over) and looking up by
 * `contract_clause_id` gives every clause its TRUE Clauses-tab number.
 */
export function buildClauseNumberMap(
  clauses: Array<Pick<ContractClause, 'id' | 'section_number'>>,
): Record<string, string> {
  const map: Record<string, string> = {};
  clauses.forEach((cc, i) => {
    map[cc.id] = clauseDisplayNumber(cc, i);
  });
  return map;
}
