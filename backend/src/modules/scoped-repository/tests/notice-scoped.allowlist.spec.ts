import { NoticeScopedRepository } from '../notice-scoped.repository';

/**
 * Option B — S2e: NoticeScopedRepository filter-KEY allowlist guard (unit, no DB).
 *
 * scopedFind interpolates each filter KEY into the SQL string (VALUES are bound
 * as parameters; keys cannot be). The base guards the key structurally: a key
 * not in the subclass's allowlist throws BEFORE any interpolation. S2e's wired
 * notice list read filters on `contract_id` only — that is the sole declared
 * key. Widening it is a deliberate per-bucket decision, never a drive-by.
 */
describe('NoticeScopedRepository — S2e filter-key allowlist (unit)', () => {
  const ORG = '00000000-0000-0000-0000-00000000000a';

  // Minimal chainable QB stub — the allowlist guard fires in the base BEFORE
  // getMany(), so no real DB is needed.
  function makeRepo(): any {
    const qb: any = {
      innerJoin: () => qb,
      andWhere: () => qb,
      leftJoinAndSelect: () => qb,
      addOrderBy: () => qb,
      getMany: async () => [],
    };
    return { createQueryBuilder: () => qb };
  }

  it('allows the declared key (contract_id) — no throw', async () => {
    const repo = new NoticeScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([]);
  });

  it('rejects a non-allowlisted filter key BEFORE it touches SQL', async () => {
    const repo = new NoticeScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ status: 'DELIVERED' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects org_id (the drift column must NEVER be a scopedFind filter)', async () => {
    const repo = new NoticeScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ org_id: ORG } as any, ORG),
    ).rejects.toThrow(/NoticeScopedRepository/);
  });
});
