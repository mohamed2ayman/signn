import { GuestInvitationScopedRepository } from '../guest-invitation-scoped.repository';

/**
 * Option B — Chokepoint migration (guest-portal, 2 of 4): GuestInvitationScoped
 * filter-KEY allowlist guard (unit, no DB).
 *
 * scopedFind / scopedFindAndCount interpolate each filter KEY into the SQL string
 * (VALUES are bound as parameters; keys cannot be). The base guards the key
 * structurally: a key not in the subclass's allowlist throws BEFORE any
 * interpolation. guest-portal wires ONLY a by-id read (revoke) — there is NO
 * scopedFind caller — so the allowlist is EMPTY: EVERY filter key throws,
 * including `contract_id`. A future bucket that wires a list read must
 * DELIBERATELY widen the set, never a drive-by.
 *
 * The empty-filter call ({}) is still valid (no keys to interpolate) — that is
 * how the faithful-base list gate is exercised in the real-PG repo spec.
 */
describe('GuestInvitationScopedRepository — filter-key allowlist (unit)', () => {
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

  it('empty filter ({}) is allowed — no keys to interpolate, no throw', async () => {
    const repo = new GuestInvitationScopedRepository(makeRepo());
    await expect(repo.scopedFind({} as any, ORG)).resolves.toEqual([]);
    await expect(repo.scopedFindAndCount({} as any, ORG)).resolves.toEqual([[], 0]);
  });

  it('rejects contract_id — empty allowlist, no list caller wired (scopedFind)', async () => {
    const repo = new GuestInvitationScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects contract_id — empty allowlist (scopedFindAndCount)', async () => {
    const repo = new GuestInvitationScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ contract_id: 'c1' } as any, ORG),
    ).rejects.toThrow(/GuestInvitationScopedRepository/);
  });

  it('rejects any non-declared key BEFORE it touches SQL (status)', async () => {
    const repo = new GuestInvitationScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ status: 'PENDING' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects a hostile key BEFORE interpolation — never reaches the SQL string', async () => {
    const repo = new GuestInvitationScopedRepository(makeRepo());
    await expect(
      repo.scopedFindAndCount({ 'contract_id = :x OR 1=1 --': 'evil' } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });
});
