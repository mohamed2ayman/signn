import { NotFoundException } from '@nestjs/common';

import { NoticesService } from '../notices.service';
import { ContractStatus } from '../../../database/entities';
import { NoticeStatus } from '../../../database/entities/notice.entity';

/**
 * Tenant-isolation Tier 3 — service-level access-wall spec for the
 * NoticesService entry points that previously did a bare findOne on
 * `contract_id`:
 *
 *   - create               (POST /notices)
 *   - findAllByContract    (GET  /notices?contract_id=)
 *
 * Cross-org → 404 (NOT 403, no existence leak); in-org → success.
 * The overdue-scan side effect in findAllByContract is gated by the
 * wall — a cross-tenant probe MUST not touch notice rows at all.
 *
 * S2e RE-AIM: the LIST read (findAllByContract) now sources its rows from the
 * scoped chokepoint (NoticeScopedRepository.scopedFind — layer 2) AFTER the
 * Tier 3 findInOrg wall (layer 1, FIRST — it is also the status source). The
 * wall stays the first gate on the list path, so a cross-tenant probe is still
 * denied by the WALL before scopedFind is reached (asserted below). The happy
 * path's final list query moved from the bare noticeRepo.find to scopedFind —
 * the in-org assertion was re-aimed accordingly. create() is UNCHANGED (it
 * inserts by a body-supplied contract_id and stays a wall-only stop-gap).
 */
describe('NoticesService — cross-tenant access wall (Tier 3 → S2e scoped list)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  type Builder = {
    noticeRepo?: any;
    noticeDocumentRepo?: any;
    noticeResponseRepo?: any;
    noticeStatusLogRepo?: any;
    contractRepo?: any;
    contractAccess: any;
    noticeScoped?: any;
  };

  function build(opts: Builder): NoticesService {
    // `any`-cast Ctor — the scoped repo is appended as the last constructor arg.
    const Ctor: any = NoticesService;
    return new Ctor(
      opts.noticeRepo ?? noop,
      opts.noticeDocumentRepo ?? noop,
      opts.noticeResponseRepo ?? noop,
      opts.noticeStatusLogRepo ?? noop,
      opts.contractRepo ?? noop,
      opts.contractAccess,
      opts.noticeScoped ?? { scopedFind: jest.fn().mockResolvedValue([]) },
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = { id: CONTRACT_IN_A, status: ContractStatus.ACTIVE }) =>
    jest.fn().mockResolvedValue(val);

  // ────────────────────────────────────────────────────────────────────
  // create — POST /notices
  // ────────────────────────────────────────────────────────────────────
  describe('create (POST /notices)', () => {
    it('cross-tenant: 404 BEFORE any notice row is touched', async () => {
      const noticeRepo = {
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ noticeRepo, contractAccess });

      await expect(
        svc.create(
          {
            contract_id: CONTRACT_IN_B, // foreign contract
            notice_type: 'CLAIM',
            title: 'x',
            description: 'x',
            event_date: '2026-06-07',
            response_required: false,
          } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(noticeRepo.count).not.toHaveBeenCalled();
      expect(noticeRepo.create).not.toHaveBeenCalled();
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, notice row saved with reference', async () => {
      const noticeRepo = {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((entity: any) => entity),
        save: jest.fn(async (entity: any) => ({ ...entity, id: 'new-notice' })),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ noticeRepo, contractAccess });

      const result = await svc.create(
        {
          contract_id: CONTRACT_IN_A,
          notice_type: 'CLAIM',
          title: 't',
          description: 'd',
          event_date: '2026-06-07',
          response_required: false,
        } as any,
        USER_ID,
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(result).toEqual(
        expect.objectContaining({
          notice_reference: 'NTC-001',
          contract_id: CONTRACT_IN_A,
          org_id: ORG_A,
          submitted_by: USER_ID,
          status: NoticeStatus.DRAFT,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // findAllByContract — GET /notices?contract_id=
  // ────────────────────────────────────────────────────────────────────
  describe('findAllByContract (GET /notices?contract_id=)', () => {
    it('cross-tenant: wall 404s FIRST — overdue scan AND scoped list never run', async () => {
      const noticeRepo = {
        find: jest.fn(),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = { scopedFind: jest.fn() };

      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      await expect(
        svc.findAllByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // Critical: the overdue scan side effect must NOT touch the victim org's
      // notice rows, and the scoped list (layer 2) is never reached either.
      expect(noticeRepo.find).not.toHaveBeenCalled();
      expect(noticeRepo.save).not.toHaveBeenCalled();
      expect(noticeScoped.scopedFind).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, notices returned from the scoped list (layer 2)', async () => {
      const NOTICES = [
        { id: 'n1', contract_id: CONTRACT_IN_A, status: NoticeStatus.DRAFT },
      ];
      const noticeRepo = {
        // The only bare-repo find left here is the checkOverdueNotices scan
        // (empty); the final list query now flows through scopedFind.
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: resolve() };
      const noticeScoped = { scopedFind: jest.fn().mockResolvedValue(NOTICES) };

      const svc = build({ noticeRepo, contractAccess, noticeScoped });
      const result = await svc.findAllByContract(CONTRACT_IN_A, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      // Layer 2 — the scoped chokepoint sourced the rows (canonical join +
      // single-level relations/order preserved).
      expect(noticeScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
        { relations: ['submitter'], order: { created_at: 'DESC' } },
      );
      expect(result).toEqual(NOTICES);
    });
  });
});
