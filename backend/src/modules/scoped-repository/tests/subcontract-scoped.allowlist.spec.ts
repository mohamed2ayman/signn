import { SubContractScopedRepository } from '../subcontract-scoped.repository';

/**
 * Option B — S2e: SubContractScopedRepository filter-KEY allowlist guard
 * (unit, no DB).
 *
 * scopedFind interpolates each filter KEY into the SQL string (VALUES are bound
 * as parameters; keys cannot be). The base guards the key structurally: a key
 * not in the subclass's allowlist throws BEFORE any interpolation. S2e's wired
 * sub-contract list read filters on `main_contract_id` only (a sub-contract's
 * parent FK) — the sole declared key. NOTE: it is `main_contract_id`, NOT
 * `contract_id`; the bare `contract_id` is intentionally NOT allowlisted.
 */
describe('SubContractScopedRepository — S2e filter-key allowlist (unit)', () => {
  const ORG = '00000000-0000-0000-0000-00000000000a';

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

  it('allows the declared key (main_contract_id) — no throw', async () => {
    const repo = new SubContractScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ main_contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([]);
  });

  it('rejects the bare contract_id (sub-contracts key on main_contract_id)', async () => {
    const repo = new SubContractScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects org_id (the drift column must NEVER be a scopedFind filter)', async () => {
    const repo = new SubContractScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ org_id: ORG } as any, ORG),
    ).rejects.toThrow(/SubContractScopedRepository/);
  });
});
