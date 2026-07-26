/**
 * Provider seam for the SOURCE of a clause's `clause_type` (Step 2).
 *
 * Today the type is a free byproduct of Sonnet extraction (the InlineExtractionProvider
 * — a pure passthrough). This interface lets a future dedicated typer (Haiku or a
 * self-hosted model) be swapped in behind a config flag WITHOUT touching the write
 * chokepoint. With the flag at its default (`inline`), production is byte-identical.
 */
export const CLAUSE_TYPE_PROVIDER = Symbol('CLAUSE_TYPE_PROVIDER');

/** One clause's fields relevant to typing. */
export interface ClauseTypeInput {
  title: string;
  content: string;
  /** The clause_type the extractor already emitted inline (used as-is by inline). */
  clause_type: string;
}

/** The assigned type + which provider produced it (recorded as clause_type_source). */
export interface ClauseTypeResult {
  clause_type: string;
  source: string;
}

export interface IClauseTypeProvider {
  /** Stable id recorded on the clause (e.g. 'sonnet-inline'). */
  readonly id: string;
  /**
   * Assign a type to each clause, returned ALIGNED to the input order. Batch-shaped
   * so a future dedicated provider can batch its model calls; the inline provider is
   * a synchronous passthrough (zero cost, output identical to today).
   */
  assignTypes(clauses: ClauseTypeInput[]): Promise<ClauseTypeResult[]>;
}
