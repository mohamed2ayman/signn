import { NotFoundException } from '@nestjs/common';

import { NoticesService } from '../notices.service';
import { NoticeStatus } from '../../../database/entities/notice.entity';

/**
 * S0-part-2 — child-id cross-tenant wall spec for the NoticesService :id routes.
 *
 * Tier 3 (#52) walled create + findAllByContract; it MISSED the :id routes
 * (findById, acknowledge, respond, updateStatus) — they took no orgId and never
 * called findInOrg, so an org-A caller could read/mutate an org-B notice by its
 * id (proven by the STEP-0 red-before exploit, since deleted). These routes now
 * resolve the wall via the notice's OWN parent contract_id (never a URL-supplied
 * contractId — the PR #45 / Tier 2 child-keyed lesson).
 *
 * Cross-tenant → 404 (NOT 403, no existence leak); in-org → success.
 * findById is the shared loader; acknowledge/respond/updateStatus inherit it.
 */
describe('NoticesService — child-id cross-tenant wall (S0-part-2)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const NOTICE_IN_B = '22222222-2222-2222-2222-2222222222b2';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  function build(opts: {
    noticeRepo?: any;
    noticeResponseRepo?: any;
    noticeStatusLogRepo?: any;
    contractAccess: any;
  }): NoticesService {
    return new NoticesService(
      opts.noticeRepo ?? noop,
      noop,
      opts.noticeResponseRepo ?? noop,
      opts.noticeStatusLogRepo ?? noop,
      noop,
      opts.contractAccess,
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  // The :id routes don't gate on contract status — findInOrg just needs to
  // resolve a contract for the in-org case.
  const resolve = () =>
    jest.fn().mockResolvedValue({ id: CONTRACT_IN_B, status: 'ACTIVE' });

  const orgBNotice = () => ({
    id: NOTICE_IN_B,
    contract_id: CONTRACT_IN_B, // belongs to ORG B
    status: NoticeStatus.DELIVERED,
  });

  // ── GET /notices/:id (READ) ──────────────────────────────────────────────
  describe('findById (GET /notices/:id)', () => {
    it('cross-tenant: 404 — wall keyed on the notice OWN contract_id, not a URL id', async () => {
      const noticeRepo = { findOne: jest.fn().mockResolvedValue(orgBNotice()) };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ noticeRepo, contractAccess });

      await expect(svc.findById(NOTICE_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // child→real-parent proof: walled with the notice's OWN contract_id.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });

    it('in-org: returns the notice', async () => {
      const noticeRepo = { findOne: jest.fn().mockResolvedValue(orgBNotice()) };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ noticeRepo, contractAccess });

      const result = await svc.findById(NOTICE_IN_B, ORG_A);
      expect(result.id).toBe(NOTICE_IN_B);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });
  });

  // ── PUT /notices/:id/acknowledge (WRITE) ─────────────────────────────────
  describe('acknowledge (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the notice row is mutated', async () => {
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ noticeRepo, contractAccess });

      await expect(
        svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: acknowledges the notice', async () => {
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(async (n: any) => n),
      };
      const noticeStatusLogRepo = { create: jest.fn((x) => x), save: jest.fn() };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ noticeRepo, noticeStatusLogRepo, contractAccess });

      const result = await svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A);
      expect(result.status).toBe(NoticeStatus.ACKNOWLEDGED);
      expect(noticeRepo.save).toHaveBeenCalled();
    });
  });

  // ── POST /notices/:id/respond (WRITE) ────────────────────────────────────
  describe('respond (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the response row is created', async () => {
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(),
      };
      const noticeResponseRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ noticeRepo, noticeResponseRepo, contractAccess });

      await expect(
        svc.respond(
          NOTICE_IN_B,
          { response_type: 'GENERAL', response_content: 'x' } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noticeResponseRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── PUT /notices/:id/status (WRITE) ──────────────────────────────────────
  describe('updateStatus (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the status is changed', async () => {
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ noticeRepo, contractAccess });

      await expect(
        svc.updateStatus(
          NOTICE_IN_B,
          { status: NoticeStatus.CLOSED } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── Bypass-role probe ────────────────────────────────────────────────────
  describe('role-agnostic wall (PLG bypass-role probe)', () => {
    it('the wall keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      // PermissionLevelGuard bypasses SYSTEM_ADMIN/OPERATIONS/OWNER_ADMIN at the
      // controller, but the service wall takes only (contractId, orgId) — there
      // is NO role input it could honour. So a bypass-role caller in ORG_A is
      // still denied an ORG_B notice. (Role is structurally irrelevant here.)
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ noticeRepo, contractAccess });

      await expect(
        svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });
  });
});
