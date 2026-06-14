import { NotFoundException } from '@nestjs/common';

import { SubContractsService } from '../subcontracts.service';
import { ContractStatus } from '../../../database/entities/contract.entity';

/**
 * Option B — S2e: the LIST + by-id loads of SubContractsService go through the
 * scoped-repository tenancy chokepoint (layer 2), UNDER the #57 in-service
 * findInOrg wall (layer 1). Two checks, two layers — never a swap.
 *
 * RED FORM (wall-neutralized independent denial): findById / update /
 * updateStatus / share are already #57-walled, so a normal cross-tenant probe
 * is denied by the WALL. The red here NEUTRALIZES the wall (findInOrg always
 * resolves) and demands the SCOPED LOAD deny independently. Pre-wire, with the
 * wall neutralized, the foreign sub-contract was read, updated, status-changed,
 * and shared. Post-wire, the scoped load 404s first (by-id) / returns [] (list)
 * and no foreign row is hydrated, mutated, or tokenised. The real-Postgres
 * data-layer denial is proven in subcontract-scoped.s2e.repository.spec.ts.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const MAIN_IN_A = '22222222-2222-2222-2222-22222222222a';
const MAIN_IN_B = '11111111-1111-1111-1111-1111111111b1';
const SUB_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const SUB_IN_A = {
  id: SUB_ID,
  main_contract_id: MAIN_IN_A,
  status: ContractStatus.DRAFT,
};
const SUB_IN_B = { ...SUB_IN_A, main_contract_id: MAIN_IN_B };

function neutralizedWall() {
  return { findInOrg: jest.fn().mockResolvedValue({}) };
}

function buildScoped(inOrgRow: any | null) {
  return {
    scopedFindByIdOrThrow: jest
      .fn()
      .mockImplementation(async (id: string, orgId: string) => {
        if (inOrgRow && id === inOrgRow.id && orgId === ORG_A) {
          return { ...inOrgRow };
        }
        throw new NotFoundException('Subcontract not found');
      }),
    scopedFind: jest.fn().mockResolvedValue(inOrgRow ? [{ ...inOrgRow }] : []),
  };
}

function buildService(opts: { repo?: any; wall: any; scoped: any }): any {
  const Ctor: any = SubContractsService;
  const noop = {} as any;
  // (subContractRepo, statusLogRepo, contractRepo, contractAccess, subContractScoped)
  return new Ctor(
    opts.repo ?? { findOne: jest.fn(), save: jest.fn(async (s: any) => s) },
    { create: jest.fn((x) => x), save: jest.fn() },
    noop,
    opts.wall,
    opts.scoped,
  );
}

describe('SubContractsService — S2e scoped loads (layer 2 under the #57 wall)', () => {
  beforeEach(jest.clearAllMocks);

  describe('findById()', () => {
    it('WALL-BYPASSED CROSS-TENANT READ: scoped denies alone → 404, foreign row NEVER hydrated', async () => {
      const repo = { findOne: jest.fn(), save: jest.fn() };
      const svc = buildService({ repo, wall: neutralizedWall(), scoped: buildScoped(null) });

      await expect(svc.findById(SUB_ID, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers consulted, hydrated row returned', async () => {
      const repo = { findOne: jest.fn().mockResolvedValue({ ...SUB_IN_A }), save: jest.fn() };
      const wall = neutralizedWall();
      const svc = buildService({ repo, wall, scoped: buildScoped(SUB_IN_A) });

      const result = await svc.findById(SUB_ID, ORG_A);
      expect(wall.findInOrg).toHaveBeenCalledWith(MAIN_IN_A, ORG_A);
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SUB_ID } }),
      );
      expect(result).toMatchObject({ id: SUB_ID });
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404', async () => {
      const repo = { findOne: jest.fn(), save: jest.fn() };
      const wall = {
        findInOrg: jest.fn().mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const svc = buildService({ repo, wall, scoped: buildScoped(SUB_IN_A) });

      await expect(svc.findById(SUB_ID, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(wall.findInOrg).toHaveBeenCalledWith(MAIN_IN_A, ORG_A);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('update() — operates on the scoped entity directly', () => {
    it('WALL-BYPASSED CROSS-TENANT WRITE: scoped denies → 404, nothing saved', async () => {
      const repo = { save: jest.fn() };
      const svc = buildService({ repo, wall: neutralizedWall(), scoped: buildScoped(null) });

      await expect(
        svc.update(SUB_ID, { subcontractor_name: 'hijacked' } as any, USER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: scoped resolves → wall fires → saved', async () => {
      const repo = { save: jest.fn(async (s: any) => s) };
      const wall = neutralizedWall();
      const svc = buildService({ repo, wall, scoped: buildScoped(SUB_IN_A) });

      await svc.update(SUB_ID, { subcontractor_name: 'amended' } as any, USER_ID, ORG_A);
      expect(wall.findInOrg).toHaveBeenCalledWith(MAIN_IN_A, ORG_A);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subcontractor_name: 'amended' }),
      );
    });
  });

  describe('share() — DESTRUCTIVE-adjacent (mints an external token)', () => {
    it('WALL-BYPASSED CROSS-TENANT: scoped denies → 404, no token minted', async () => {
      const svc = buildService({ wall: neutralizedWall(), scoped: buildScoped(null) });

      await expect(svc.share(SUB_ID, USER_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('happy path: scoped resolves → wall fires → token returned', async () => {
      const wall = neutralizedWall();
      const svc = buildService({ wall, scoped: buildScoped(SUB_IN_A) });

      const result = await svc.share(SUB_ID, USER_ID, ORG_A);
      expect(wall.findInOrg).toHaveBeenCalledWith(MAIN_IN_A, ORG_A);
      expect(result.token).toEqual(expect.any(String));
    });
  });

  describe('findAllByMainContract() — scoped LIST (layer 2)', () => {
    it('WALL-BYPASSED CROSS-TENANT LIST: scopedFind returns [] → empty result', async () => {
      const wall = {
        findInOrg: jest.fn().mockResolvedValue({ id: MAIN_IN_B, status: 'ACTIVE' }),
      };
      const scoped = buildScoped(null);
      const svc = buildService({ wall, scoped });

      const result = await svc.findAllByMainContract(MAIN_IN_B, ORG_A);
      expect(result).toEqual([]);
      expect(scoped.scopedFind).toHaveBeenCalledWith(
        { main_contract_id: MAIN_IN_B },
        ORG_A,
        { relations: ['creator', 'mainContract'], order: { created_at: 'DESC' } },
      );
    });

    it('S0 wall STAYS first: cross-tenant main contract → findInOrg 404 short-circuits before scopedFind', async () => {
      const wall = {
        findInOrg: jest.fn().mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(SUB_IN_B);
      const svc = buildService({ wall, scoped });

      await expect(
        svc.findAllByMainContract(MAIN_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(scoped.scopedFind).not.toHaveBeenCalled();
    });
  });
});
