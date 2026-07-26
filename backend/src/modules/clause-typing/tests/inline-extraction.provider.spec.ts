import { InlineExtractionProvider } from '../providers/inline-extraction.provider';

describe('InlineExtractionProvider (default clause-type provider)', () => {
  const provider = new InlineExtractionProvider();

  it('has the stable source id recorded on clauses', () => {
    expect(provider.id).toBe('sonnet-inline');
  });

  it('returns each clause_type UNCHANGED (production byte-parity) + tags the source', async () => {
    const input = [
      { title: 'A', content: 'pay within 30 days', clause_type: 'payment' },
      { title: 'B', content: 'يلتزم المقاول بالمدة', clause_type: 'time' },
      { title: 'C', content: 'definitions', clause_type: 'general' },
    ];
    const out = await provider.assignTypes(input);
    // aligned, one-per-input, clause_type identical to the extractor's own output
    expect(out).toEqual([
      { clause_type: 'payment', source: 'sonnet-inline' },
      { clause_type: 'time', source: 'sonnet-inline' },
      { clause_type: 'general', source: 'sonnet-inline' },
    ]);
    expect(out.map((o) => o.clause_type)).toEqual(input.map((i) => i.clause_type));
  });

  it('handles an empty batch', async () => {
    expect(await provider.assignTypes([])).toEqual([]);
  });
});
