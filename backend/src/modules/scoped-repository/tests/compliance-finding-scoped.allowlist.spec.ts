import { ComplianceFindingScopedRepository } from '../compliance-finding-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale, 4 of 4):
 * ComplianceFindingScoped filter-KEY allowlist guard (unit, no DB).
 *
 * The compliance bucket wires ONLY a by-id read on findings
 * (ComplianceFindingService.updateStatus) — there is NO scopedFind caller — so
 * the allowlist is EMPTY: EVERY filter key throws, including `compliance_check_id`.
 * A future bucket that wires a list read (e.g. reviving the dead listForCheck)
 * must DELIBERATELY widen the set, never a drive-by. The empty-filter call ({})
 * is still valid (no keys to interpolate).
 */
describe('ComplianceFindingScopedRepository — filter-key allowlist (unit)', () => {
  const ORG = '00000000-0000-0000-0000-00000000000a';

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

  it('empty filter ({}) is allowed — no keys to interpolate, no throw', async () => {
    const repo = new ComplianceFindingScopedRepository(makeRepo());
    await expect(repo.scopedFind({} as any, ORG)).resolves.toEqual([]);
    await expect(repo.scopedFindAndCount({} as any, ORG)).resolves.toEqual([[], 0]);
  });

  it('rejects compliance_check_id — empty allowlist, no list caller wired (scopedFind)', async () => {
    const repo = new ComplianceFindingScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ compliance_check_id: 'k1' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects compliance_check_id (scopedFindAndCount)', async () => {
    const repo = new ComplianceFindingScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ compliance_check_id: 'k1' } as any, ORG),
    ).rejects.toThrow(/ComplianceFindingScopedRepository/);
  });

  it('rejects status — not declared', async () => {
    const repo = new ComplianceFindingScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ status: 'OPEN' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects a hostile key BEFORE interpolation — never reaches the SQL string', async () => {
    const repo = new ComplianceFindingScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ 'id = :x OR 1=1 --': 'evil' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });
});
