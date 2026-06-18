import { ComplianceCheckScopedRepository } from '../compliance-check-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale, 4 of 4):
 * ComplianceCheckScoped filter-KEY allowlist guard (unit, no DB).
 *
 * scopedFind / scopedFindAndCount interpolate each filter KEY into the SQL string
 * (VALUES are bound as parameters; keys cannot be). The base guards the key
 * structurally: a key not in the subclass's allowlist throws BEFORE any
 * interpolation. The compliance bucket wires listForContract, which filters on
 * `contract_id` ONLY — so that key is allowed and EVERY other key (including the
 * denormalized `project_id`, and `id`) throws. Widening the set is a deliberate
 * per-bucket decision, never a drive-by.
 */
describe('ComplianceCheckScopedRepository — filter-key allowlist (unit)', () => {
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

  it('allows contract_id — the wired listForContract filter (scopedFindAndCount)', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([[], 0]);
  });

  it('allows contract_id (scopedFind)', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(repo.scopedFind({ contract_id: 'c1' } as any, ORG)).resolves.toEqual([]);
  });

  it('empty filter ({}) is allowed — no keys to interpolate, no throw', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(repo.scopedFind({} as any, ORG)).resolves.toEqual([]);
  });

  it('rejects the denormalized project_id — NOT on the org-resolution path, not allowlisted', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ project_id: 'p1' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects id — not a wired list filter', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ id: 'x1' } as any, ORG),
    ).rejects.toThrow(/ComplianceCheckScopedRepository/);
  });

  it('rejects a hostile key BEFORE interpolation — never reaches the SQL string', async () => {
    const repo = new ComplianceCheckScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ 'contract_id = :x OR 1=1 --': 'evil' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });
});
