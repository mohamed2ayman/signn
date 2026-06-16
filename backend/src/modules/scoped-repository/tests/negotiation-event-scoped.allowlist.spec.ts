import { NegotiationEventScopedRepository } from '../negotiation-event-scoped.repository';

/**
 * Option B — Chokepoint migration (negotiation, 1 of 4): NegotiationEventScoped
 * filter-KEY allowlist guard (unit, no DB).
 *
 * scopedFind / scopedFindAndCount interpolate each filter KEY into the SQL
 * string (VALUES are bound as parameters; keys cannot be). The base guards the
 * key structurally: a key not in the subclass's allowlist throws BEFORE any
 * interpolation. The wired findHistory read filters on `contract_id` (always)
 * and `clause_ref` (optional) — those two are the sole declared keys. Widening
 * the set is a deliberate per-bucket decision, never a drive-by.
 *
 * Both list methods share the SAME guard (base.applyScopedListOptions), so the
 * probes run them through scopedFindAndCount (the wired path) AND scopedFind.
 */
describe('NegotiationEventScopedRepository — filter-key allowlist (unit)', () => {
  const ORG = '00000000-0000-0000-0000-00000000000a';

  // Minimal chainable QB stub — the allowlist guard fires in the base BEFORE
  // getMany()/getManyAndCount(), so no real DB is needed.
  function makeRepo(): any {
    const qb: any = {
      innerJoin: () => qb,
      andWhere: () => qb,
      leftJoinAndSelect: () => qb,
      addOrderBy: () => qb,
      skip: () => qb,
      take: () => qb,
      getMany: async () => [],
      getManyAndCount: async () => [[], 0],
    };
    return { createQueryBuilder: () => qb };
  }

  it('allows the declared keys (contract_id + clause_ref) via scopedFindAndCount — no throw', async () => {
    const repo = new NegotiationEventScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount(
        { contract_id: 'c1', clause_ref: '4.2' } as any,
        ORG,
        { relations: ['performer'], order: { created_at: 'DESC' }, take: 50, skip: 0 },
      ),
    ).resolves.toEqual([[], 0]);
  });

  it('allows contract_id via scopedFind — no throw', async () => {
    const repo = new NegotiationEventScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([]);
  });

  it('rejects a non-allowlisted filter key BEFORE it touches SQL (scopedFindAndCount)', async () => {
    const repo = new NegotiationEventScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ event_type: 'CLAUSE_FLAGGED' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects a non-allowlisted filter key BEFORE it touches SQL (scopedFind)', async () => {
    const repo = new NegotiationEventScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ performed_by: ORG } as any, ORG),
    ).rejects.toThrow(/NegotiationEventScopedRepository/);
  });

  it('rejects a hostile key BEFORE interpolation — never reaches the SQL string', async () => {
    const repo = new NegotiationEventScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ 'contract_id = :x OR 1=1 --': 'evil' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });
});
