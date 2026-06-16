import { NotFoundException } from '@nestjs/common';

import { NegotiationService } from '../negotiation.service';

/**
 * Option B — Chokepoint migration (negotiation, 1 of 4): NegotiationService's
 * findHistory LIST read goes through the scoped-repository tenancy chokepoint
 * (layer 2 — the NEW paginated scopedFindAndCount), UNDER the inline
 * assertContractInOrg wall (layer 1). Two checks, two layers — never a swap.
 * The wall is KEPT inline (not consolidated into ContractAccessService.findInOrg).
 *
 * RED FORM (wall-neutralized independent denial): findHistory is already walled,
 * so a cross-tenant probe through the normal path is denied by the WALL and
 * cannot reproduce a data-layer red. The red here therefore NEUTRALIZES the wall
 * (assertContractInOrg always resolves — simulating a wall bug/bypass) and
 * demands the SCOPED LOAD deny independently. Pre-wire, with the wall
 * neutralized, findHistory's bare QB filtered only on contract_id and would have
 * listed (and counted) the foreign rows. Post-wire, scopedFindAndCount returns
 * [[], 0] on its own. The data-layer denial against real Postgres is proven in
 * negotiation-event-scoped.repository.spec.ts.
 *
 * The service is constructed through an `any`-cast so the spec RUNS even as the
 * constructor evolves — same device the S2c-2/S2e wiring specs documented.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

const EVENT_IN_A = { id: EVENT_ID, contract_id: CONTRACT_IN_A, clause_ref: 'CL-1' };

/**
 * Wall (assertContractInOrg) backing repo. `getOne` resolves the wall outcome:
 *   - a truthy contract  → wall PASSES (neutralized / in-org)
 *   - null               → wall DENIES → assertContractInOrg throws 404
 */
function buildWallRepo(contractOrNull: any) {
  const qb: any = {
    innerJoin: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getOne: jest.fn().mockResolvedValue(contractOrNull),
  };
  return { createQueryBuilder: jest.fn(() => qb) };
}

/** Event repo — used only by the write path; findHistory never touches it. */
function buildEventRepo() {
  return { save: jest.fn(async (e: any) => e), create: jest.fn((x) => x) };
}

/**
 * Scoped-repo mock with the REAL deny semantics: resolves [[row], 1] only for
 * the (CONTRACT_IN_A, ORG_A) pair; anything cross-tenant yields [[], 0] — exactly
 * what NegotiationEventScopedRepository.scopedFindAndCount does against Postgres
 * (proven in negotiation-event-scoped.repository.spec.ts).
 */
function buildScoped(resolveInOrg: boolean) {
  return {
    scopedFindAndCount: jest
      .fn()
      .mockImplementation(async (filter: any, orgId: string) => {
        if (resolveInOrg && filter.contract_id === CONTRACT_IN_A && orgId === ORG_A) {
          return [[{ ...EVENT_IN_A }], 1];
        }
        return [[], 0];
      }),
  };
}

function buildService(eventRepo: any, wallRepo: any, scoped: any): any {
  const Ctor: any = NegotiationService;
  // (eventRepository, contractRepository, negotiationEventScoped)
  return new Ctor(eventRepo, wallRepo, scoped);
}

describe('NegotiationService.findHistory — scoped LIST (layer 2 under the inline wall)', () => {
  beforeEach(jest.clearAllMocks);

  it('WALL-BYPASSED CROSS-TENANT LIST: scopedFindAndCount returns [[], 0] → empty result', async () => {
    const eventRepo = buildEventRepo();
    // Wall NEUTRALIZED — resolves a (foreign) contract so the flow reaches the
    // scoped load, which must exclude the foreign rows on its own.
    const wallRepo = buildWallRepo({ id: CONTRACT_IN_B });
    const scoped = buildScoped(false); // scopedFindAndCount → [[], 0]
    const svc = buildService(eventRepo, wallRepo, scoped);

    const result = await svc.findHistory(CONTRACT_IN_B, ORG_A, {});
    expect(result).toEqual({ events: [], total: 0 });
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_B },
      ORG_A,
      { relations: ['performer'], order: { created_at: 'DESC' }, take: 50, skip: 0 },
    );
  });

  it('happy path: BOTH layers consulted — wall passes, scoped returns rows + total', async () => {
    const eventRepo = buildEventRepo();
    const wallRepo = buildWallRepo({ id: CONTRACT_IN_A });
    const scoped = buildScoped(true);
    const svc = buildService(eventRepo, wallRepo, scoped);

    const result = await svc.findHistory(CONTRACT_IN_A, ORG_A, {});
    expect(result).toEqual({ events: [expect.objectContaining({ id: EVENT_ID })], total: 1 });
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_A },
      ORG_A,
      { relations: ['performer'], order: { created_at: 'DESC' }, take: 50, skip: 0 },
    );
  });

  it('wall is NOT dead code: wall DENIES (404) → short-circuits before scopedFindAndCount', async () => {
    const eventRepo = buildEventRepo();
    const wallRepo = buildWallRepo(null); // wall denies → assertContractInOrg throws 404
    const scoped = buildScoped(true);
    const svc = buildService(eventRepo, wallRepo, scoped);

    await expect(svc.findHistory(CONTRACT_IN_B, ORG_A, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(scoped.scopedFindAndCount).not.toHaveBeenCalled();
  });

  it('clause_ref is added to the filter ONLY when provided', async () => {
    const eventRepo = buildEventRepo();
    const wallRepo = buildWallRepo({ id: CONTRACT_IN_A });
    const scoped = buildScoped(true);
    const svc = buildService(eventRepo, wallRepo, scoped);

    await svc.findHistory(CONTRACT_IN_A, ORG_A, { clause_ref: 'CL-9' });
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_A, clause_ref: 'CL-9' },
      ORG_A,
      expect.objectContaining({ relations: ['performer'] }),
    );

    scoped.scopedFindAndCount.mockClear();

    await svc.findHistory(CONTRACT_IN_A, ORG_A, {});
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_A },
      ORG_A,
      expect.anything(),
    );
  });

  it('limit/offset are clamped and passed as take/skip', async () => {
    const eventRepo = buildEventRepo();
    const wallRepo = buildWallRepo({ id: CONTRACT_IN_A });
    const scoped = buildScoped(true);
    const svc = buildService(eventRepo, wallRepo, scoped);

    // limit 1000 → clamped to 200; offset 5 → 5
    await svc.findHistory(CONTRACT_IN_A, ORG_A, { limit: 1000, offset: 5 });
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_A },
      ORG_A,
      expect.objectContaining({ take: 200, skip: 5 }),
    );

    scoped.scopedFindAndCount.mockClear();

    // limit 0 → clamped to 1; offset -5 → 0
    await svc.findHistory(CONTRACT_IN_A, ORG_A, { limit: 0, offset: -5 });
    expect(scoped.scopedFindAndCount).toHaveBeenCalledWith(
      { contract_id: CONTRACT_IN_A },
      ORG_A,
      expect.objectContaining({ take: 1, skip: 0 }),
    );
  });
});
