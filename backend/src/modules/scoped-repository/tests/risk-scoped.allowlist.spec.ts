import { RiskScopedRepository } from '../risk-scoped.repository';

/**
 * Option B — S2d: RiskScopedRepository filter-KEY allowlist guard (unit, no DB).
 *
 * scopedFind interpolates each filter KEY into the SQL string (VALUES are bound
 * as parameters; keys cannot be). The base guards the key structurally: a key
 * not in the subclass's allowlist throws BEFORE any interpolation. S2d's wired
 * risk reads all filter on `contract_id` only — that is the sole declared key.
 * Widening it is a deliberate per-bucket decision, never a drive-by.
 */
describe('RiskScopedRepository — S2d filter-key allowlist (unit)', () => {
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
    const repo = new RiskScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([]);
  });

  it('rejects a non-allowlisted filter key BEFORE it touches SQL', async () => {
    const repo = new RiskScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ status: 'OPEN' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects risk_level (a tempting but undeclared key)', async () => {
    const repo = new RiskScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ risk_level: 'HIGH' } as any, ORG),
    ).rejects.toThrow(/RiskScopedRepository/);
  });
});
