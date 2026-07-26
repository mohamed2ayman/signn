import {
  ClauseTypeInput,
  ClauseTypeResult,
  IClauseTypeProvider,
} from '../interfaces/clause-type-provider.interface';

/**
 * DEFAULT provider — the type comes FREE from the extractor's inline output.
 * A pure passthrough: returns each clause's already-emitted `clause_type`
 * unchanged, tagged with the source id. Zero cost, zero extra AI call, output
 * byte-identical to today's behavior.
 */
export class InlineExtractionProvider implements IClauseTypeProvider {
  readonly id = 'sonnet-inline';

  async assignTypes(clauses: ClauseTypeInput[]): Promise<ClauseTypeResult[]> {
    return clauses.map((c) => ({ clause_type: c.clause_type, source: this.id }));
  }
}
