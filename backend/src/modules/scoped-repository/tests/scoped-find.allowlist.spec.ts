import { Repository } from 'typeorm';

import { Obligation } from '../../../database/entities';
import { ObligationScopedRepository } from '../obligation-scoped.repository';

/**
 * Option B — S2c-1: filter-key ALLOWLIST guard on the base's scopedFind
 * (Ayman ratified).
 *
 * scopedFind interpolates each filter KEY into the SQL string (values are
 * always bound as parameters; keys cannot be). Today every key at every call
 * site is a code-controlled literal, but later buckets wire more callers — so
 * the key is guarded structurally: each scoped subclass declares its allowed
 * filter keys, and scopedFind throws on a non-allowlisted key BEFORE any
 * interpolation happens.
 *
 * Red-before/green-after: the "throws on a non-allowlisted key" probes below
 * FAILED against the pre-guard base (the unknown/hostile key was interpolated
 * into the query string and the query executed).
 *
 * Pure unit spec (mocked Repository / query builder) — runs in CI; the real
 * tenancy SQL is proven separately by the real-Postgres S2c-1 spec.
 */
describe('ScopedContractRepository.scopedFind — filter-key allowlist (S2c-1)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_A = '11111111-1111-1111-1111-1111111111a1';

  let qb: any;
  let repo: jest.Mocked<Repository<Obligation>>;
  let scoped: ObligationScopedRepository;

  beforeEach(() => {
    qb = {
      innerJoin: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as jest.Mocked<Repository<Obligation>>;
    scoped = new ObligationScopedRepository(repo as Repository<Obligation>);
  });

  it('allowlisted key passes: contract_id is interpolated with a bound parameter', async () => {
    await expect(
      scoped.scopedFind({ contract_id: CONTRACT_A }, ORG_A),
    ).resolves.toEqual([]);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'obligation.contract_id = :flt_contract_id',
      { flt_contract_id: CONTRACT_A },
    );
    expect(qb.getMany).toHaveBeenCalled();
  });

  it('non-allowlisted (benign) key throws — and the query is NEVER executed', async () => {
    // `status` is a real Obligation column, but S2c-1 wires no caller that
    // filters on it — so it is NOT in the allowlist and must throw until a
    // bucket deliberately adds it.
    await expect(
      scoped.scopedFind({ status: 'PENDING' } as any, ORG_A),
    ).rejects.toThrow(/not allowlisted/);

    expect(qb.getMany).not.toHaveBeenCalled();
  });

  it('hostile key throws BEFORE interpolation — the key never reaches the SQL string', async () => {
    const hostileKey = 'contract_id = :x OR 1=1 --';

    await expect(
      scoped.scopedFind({ [hostileKey]: 'evil' } as any, ORG_A),
    ).rejects.toThrow(/not allowlisted/);

    // The guard fires BEFORE the andWhere interpolation: no andWhere call ever
    // saw the hostile key, and the query never ran.
    const interpolated = qb.andWhere.mock.calls.map((c: any[]) => String(c[0]));
    expect(interpolated.some((sql: string) => sql.includes('1=1'))).toBe(false);
    expect(qb.getMany).not.toHaveBeenCalled();
  });

  it('the org gate is applied regardless of filter outcome (structural, on the gate alias)', async () => {
    await scoped.scopedFind({ contract_id: CONTRACT_A }, ORG_A);

    // The tenancy predicate lives on the gate alias and is untouchable by
    // filter keys (which are restricted to the entity alias + allowlist).
    expect(qb.andWhere).toHaveBeenCalledWith(
      'org_gate_project.organization_id = :orgId',
      { orgId: ORG_A },
    );
  });

  it('empty filter is fine — no keys, nothing to allowlist, org gate still applied', async () => {
    await expect(scoped.scopedFind({}, ORG_A)).resolves.toEqual([]);
    expect(qb.andWhere).toHaveBeenCalledWith(
      'org_gate_project.organization_id = :orgId',
      { orgId: ORG_A },
    );
  });
});
