import { NotFoundException } from '@nestjs/common';

import { NoticesService } from '../notices.service';
import { NoticeStatus } from '../../../database/entities/notice.entity';

/**
 * Option B — S2e: the LIST + by-id loads of NoticesService go through the
 * scoped-repository tenancy chokepoint (layer 2), UNDER the #57 in-service
 * findInOrg wall (layer 1). Two checks, two layers — never a swap.
 *
 * RED FORM (wall-neutralized independent denial): findById is already
 * #57-walled, so a cross-tenant probe through the normal path is denied by the
 * WALL and cannot reproduce a data-layer red. The red here therefore
 * NEUTRALIZES the wall (findInOrg always resolves — simulating a wall bug or
 * bypass) and demands the SCOPED LOAD deny independently. Pre-wire, with the
 * wall neutralized, findById returned the foreign row, acknowledge/respond/
 * updateStatus saved it, and findAllByContract listed it. Post-wire, the scoped
 * load 404s first (by-id) / returns [] (list) and no foreign row is hydrated or
 * mutated. The data-layer denial against real Postgres is proven in
 * notice-scoped.s2e.repository.spec.ts.
 *
 * The service is constructed through an `any`-cast so the spec RUNS even as the
 * constructor evolves — same device the S2c-2 wiring spec documented.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
const NOTICE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const NOTICE_IN_A = {
  id: NOTICE_ID,
  contract_id: CONTRACT_IN_A,
  status: NoticeStatus.DELIVERED,
};
const NOTICE_IN_B = { ...NOTICE_IN_A, contract_id: CONTRACT_IN_B };

/** #57 wall NEUTRALIZED — always passes. The scoped load must deny alone. */
function neutralizedWall() {
  return { findInOrg: jest.fn().mockResolvedValue({}) };
}

function buildRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row ? { ...row } : null),
    find: jest.fn().mockResolvedValue(row ? [{ ...row }] : []),
    save: jest.fn().mockImplementation(async (n: any) => n),
    create: jest.fn((x) => x),
  };
}

/**
 * Scoped-repo mock with the REAL deny semantics: resolves only the
 * (NOTICE_ID, ORG_A) pair when the notice is in-org; anything else throws the
 * no-existence-leak 404 — exactly what NoticeScopedRepository.scopedFindByIdOrThrow
 * does against Postgres (proven in notice-scoped.s2e.repository.spec.ts).
 */
function buildScoped(inOrgRow: any | null) {
  return {
    scopedFindByIdOrThrow: jest
      .fn()
      .mockImplementation(async (id: string, orgId: string) => {
        if (inOrgRow && id === inOrgRow.id && orgId === ORG_A) {
          return { ...inOrgRow };
        }
        throw new NotFoundException('Notice not found');
      }),
    scopedFind: jest.fn().mockResolvedValue(inOrgRow ? [{ ...inOrgRow }] : []),
  };
}

function buildService(repo: any, wall: any, scoped: any): any {
  const Ctor: any = NoticesService;
  // (noticeRepo, noticeDocumentRepo, noticeResponseRepo, noticeStatusLogRepo,
  //  contractRepo, contractAccess, noticeScoped)
  const noop = {} as any;
  const responseRepo = { create: jest.fn((x) => x), save: jest.fn(async (r: any) => r) };
  const statusLogRepo = { create: jest.fn((x) => x), save: jest.fn() };
  return new Ctor(repo, noop, responseRepo, statusLogRepo, noop, wall, scoped);
}

describe('NoticesService — S2e scoped loads (layer 2 under the #57 wall)', () => {
  beforeEach(jest.clearAllMocks);

  describe('findById()', () => {
    it('WALL-BYPASSED CROSS-TENANT READ: scoped load denies alone → 404, foreign row NEVER hydrated', async () => {
      const repo = buildRepo(NOTICE_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null); // notice NOT in org A
      const svc = buildService(repo, wall, scoped);

      await expect(svc.findById(NOTICE_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(NOTICE_ID, ORG_A);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers consulted — scoped resolves, wall fires, hydrated row returned', async () => {
      const repo = buildRepo(NOTICE_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(NOTICE_IN_A);
      const svc = buildService(repo, wall, scoped);

      const result = await svc.findById(NOTICE_ID, ORG_A);
      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(NOTICE_ID, ORG_A);
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: NOTICE_ID } }),
      );
      expect(result).toMatchObject({ id: NOTICE_ID });
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404 (two layers, not a swap)', async () => {
      const repo = buildRepo(NOTICE_IN_A);
      const wall = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(NOTICE_IN_A);
      const svc = buildService(repo, wall, scoped);

      await expect(svc.findById(NOTICE_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('acknowledge() — write inheritor of the scoped findById', () => {
    it('WALL-BYPASSED CROSS-TENANT WRITE: scoped denies → 404, nothing saved', async () => {
      const repo = buildRepo(NOTICE_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.acknowledge(NOTICE_ID, USER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: flows through the scoped findById, then saves', async () => {
      const repo = buildRepo(NOTICE_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(NOTICE_IN_A);
      const svc = buildService(repo, wall, scoped);

      await svc.acknowledge(NOTICE_ID, USER_ID, ORG_A);
      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(NOTICE_ID, ORG_A);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NoticeStatus.ACKNOWLEDGED }),
      );
    });
  });

  describe('findAllByContract() — scoped LIST (layer 2)', () => {
    it('WALL-BYPASSED CROSS-TENANT LIST: scopedFind returns [] → empty result', async () => {
      const repo = buildRepo(NOTICE_IN_B);
      // For the list path the wall is FIRST (it is the status source). Neutralize
      // it WITH an ACTIVE status so the flow reaches scopedFind, which must
      // exclude the foreign rows on its own.
      const wall = {
        findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_B, status: 'ACTIVE' }),
      };
      const scoped = buildScoped(null); // scopedFind → []
      const svc = buildService(repo, wall, scoped);

      const result = await svc.findAllByContract(CONTRACT_IN_B, ORG_A);
      expect(result).toEqual([]);
      expect(scoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_B },
        ORG_A,
        { relations: ['submitter'], order: { created_at: 'DESC' } },
      );
    });

    it('S0 wall STAYS first: cross-tenant contract → findInOrg 404 short-circuits before scopedFind', async () => {
      const repo = buildRepo(NOTICE_IN_B);
      const wall = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(NOTICE_IN_B);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.findAllByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(scoped.scopedFind).not.toHaveBeenCalled();
    });
  });
});
