import { NotFoundException } from '@nestjs/common';

import { ClaimsService } from '../claims.service';
import { ClaimStatus } from '../../../database/entities/claim.entity';

/**
 * Option B — S2e: the LIST + by-id loads of ClaimsService go through the
 * scoped-repository tenancy chokepoint (layer 2), UNDER the #57 in-service
 * findInOrg wall (layer 1). Two checks, two layers — never a swap.
 *
 * RED FORM (wall-neutralized independent denial): findById / uploadDocument are
 * already #57-walled, so a normal cross-tenant probe is denied by the WALL. The
 * red here NEUTRALIZES the wall (findInOrg always resolves) and demands the
 * SCOPED LOAD deny independently. Pre-wire, with the wall neutralized, findById
 * returned the foreign row, acknowledge/uploadDocument wrote against it, and
 * findAllByContract listed it. Post-wire, the scoped load 404s first (by-id) /
 * returns [] (list) and no foreign row is hydrated, mutated, or attached-to.
 * The real-Postgres data-layer denial is proven in
 * claim-scoped.s2e.repository.spec.ts.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
const CLAIM_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const CLAIM_IN_A = {
  id: CLAIM_ID,
  contract_id: CONTRACT_IN_A,
  status: ClaimStatus.SUBMITTED,
};
const CLAIM_IN_B = { ...CLAIM_IN_A, contract_id: CONTRACT_IN_B };

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
        throw new NotFoundException('Claim not found');
      }),
    scopedFind: jest.fn().mockResolvedValue(inOrgRow ? [{ ...inOrgRow }] : []),
  };
}

function buildService(opts: { repo?: any; docRepo?: any; wall: any; scoped: any }): any {
  const Ctor: any = ClaimsService;
  const noop = {} as any;
  // (claimRepo, claimDocumentRepo, claimResponseRepo, claimStatusLogRepo,
  //  contractRepo, contractAccess, claimScoped)
  return new Ctor(
    opts.repo ?? { findOne: jest.fn(), find: jest.fn(), save: jest.fn(async (c: any) => c) },
    opts.docRepo ?? { create: jest.fn((x) => x), save: jest.fn(async (d: any) => d) },
    { create: jest.fn((x) => x), save: jest.fn(async (r: any) => r) },
    { create: jest.fn((x) => x), save: jest.fn() },
    noop,
    opts.wall,
    opts.scoped,
  );
}

describe('ClaimsService — S2e scoped loads (layer 2 under the #57 wall)', () => {
  beforeEach(jest.clearAllMocks);

  describe('findById()', () => {
    it('WALL-BYPASSED CROSS-TENANT READ: scoped denies alone → 404, foreign row NEVER hydrated', async () => {
      const repo = { findOne: jest.fn(), save: jest.fn() };
      const svc = buildService({ repo, wall: neutralizedWall(), scoped: buildScoped(null) });

      await expect(svc.findById(CLAIM_ID, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers consulted, hydrated row returned', async () => {
      const repo = { findOne: jest.fn().mockResolvedValue({ ...CLAIM_IN_A }), save: jest.fn() };
      const wall = neutralizedWall();
      const svc = buildService({ repo, wall, scoped: buildScoped(CLAIM_IN_A) });

      const result = await svc.findById(CLAIM_ID, ORG_A);
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CLAIM_ID } }),
      );
      expect(result).toMatchObject({ id: CLAIM_ID });
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404', async () => {
      const repo = { findOne: jest.fn(), save: jest.fn() };
      const wall = {
        findInOrg: jest.fn().mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const svc = buildService({ repo, wall, scoped: buildScoped(CLAIM_IN_A) });

      await expect(svc.findById(CLAIM_ID, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('uploadDocument() — own scoped loader', () => {
    it('WALL-BYPASSED CROSS-TENANT: scoped denies → 404, no document created', async () => {
      const docRepo = { create: jest.fn(), save: jest.fn() };
      const svc = buildService({ docRepo, wall: neutralizedWall(), scoped: buildScoped(null) });

      await expect(
        svc.uploadDocument(
          CLAIM_ID,
          { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(docRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: scoped resolves → wall fires → document saved', async () => {
      const docRepo = { create: jest.fn((x) => x), save: jest.fn(async (d: any) => ({ ...d, id: 'doc-1' })) };
      const wall = neutralizedWall();
      const svc = buildService({ docRepo, wall, scoped: buildScoped(CLAIM_IN_A) });

      const result = await svc.uploadDocument(
        CLAIM_ID,
        { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
        USER_ID,
        ORG_A,
      );
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(result.id).toBe('doc-1');
    });
  });

  describe('findAllByContract() — scoped LIST (layer 2)', () => {
    it('WALL-BYPASSED CROSS-TENANT LIST: scopedFind returns [] → empty result', async () => {
      const wall = {
        findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_B, status: 'ACTIVE' }),
      };
      const scoped = buildScoped(null);
      const svc = buildService({ wall, scoped });

      const result = await svc.findAllByContract(CONTRACT_IN_B, ORG_A);
      expect(result).toEqual([]);
      expect(scoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_B },
        ORG_A,
        { relations: ['submitter', 'documents'], order: { created_at: 'DESC' } },
      );
    });

    it('S0 wall STAYS first: cross-tenant contract → findInOrg 404 short-circuits before scopedFind', async () => {
      const wall = {
        findInOrg: jest.fn().mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(CLAIM_IN_B);
      const svc = buildService({ wall, scoped });

      await expect(
        svc.findAllByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(scoped.scopedFind).not.toHaveBeenCalled();
    });
  });
});
