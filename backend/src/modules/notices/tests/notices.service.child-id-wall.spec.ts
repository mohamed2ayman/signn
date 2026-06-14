import { NotFoundException } from '@nestjs/common';

import { NoticesService } from '../notices.service';
import { NoticeStatus } from '../../../database/entities/notice.entity';

/**
 * S0-part-2 — child-id cross-tenant wall spec for the NoticesService :id routes.
 *
 * Tier 3 (#52) walled create + findAllByContract; it MISSED the :id routes
 * (findById, acknowledge, respond, updateStatus) — they took no orgId and never
 * called findInOrg, so an org-A caller could read/mutate an org-B notice by its
 * id (proven by the STEP-0 red-before exploit, since deleted). These routes were
 * #57-walled by resolving the notice's OWN parent contract_id via findInOrg.
 *
 * S2e RE-AIM: Option B subsumed the by-id LOAD into the scoped-repository
 * chokepoint (NoticeScopedRepository.scopedFindByIdOrThrow — layer 2, consulted
 * FIRST), with the findInOrg wall STAYING above it as layer 1 and the trailing
 * findOne now a HYDRATION on the validated id. Cross-tenant denial therefore
 * fires at the SCOPED layer before the wall or hydration are reached — the
 * cross-tenant assertions below were re-aimed accordingly (scoped consulted;
 * wall + hydration NOT reached, foreign row never mutated), while the happy
 * paths assert BOTH layers are consulted (wall liveness preserved — two layers,
 * never a swap) and a dedicated test proves the wall is NOT dead code (scoped
 * passes, wall denies → 404). The scoped layer's own independent denial is
 * proven in notices.service.s2e-scoped-wiring.spec.ts (mock, wall-neutralized)
 * and notice-scoped.s2e.repository.spec.ts (real Postgres).
 *
 * BEFORE (pre-S2e): cross-tenant tests asserted
 *   expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A)
 *   and mocked noticeRepo.findOne to return the foreign row.
 * AFTER  (S2e):     cross-tenant tests assert
 *   expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(NOTICE_IN_B, ORG_A),
 *   expect(contractAccess.findInOrg).not.toHaveBeenCalled(),
 *   expect(noticeRepo.findOne).not.toHaveBeenCalled().
 *
 * Cross-tenant → 404 (NOT 403, no existence leak); in-org → success.
 * findById is the shared loader; acknowledge/respond/updateStatus inherit it.
 */
describe('NoticesService — child-id cross-tenant wall (S0-part-2 → S2e two-layer)', () => {
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
    noticeScoped: any;
  }): NoticesService {
    // `any`-cast Ctor so the spec RUNS against whatever the current constructor
    // is (the scoped repo is appended as the last arg) — same device the S2c-2
    // re-aim used.
    const Ctor: any = NoticesService;
    return new Ctor(
      opts.noticeRepo ?? noop,
      noop,
      opts.noticeResponseRepo ?? noop,
      opts.noticeStatusLogRepo ?? noop,
      noop,
      opts.contractAccess,
      opts.noticeScoped,
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = () =>
    jest.fn().mockResolvedValue({ id: CONTRACT_IN_B, status: 'ACTIVE' });

  const orgBNotice = () => ({
    id: NOTICE_IN_B,
    contract_id: CONTRACT_IN_B, // belongs to ORG B
    status: NoticeStatus.DELIVERED,
  });

  /** Scoped layer-2 with real deny semantics: resolves the row only in-org. */
  const scopedResolve = (row: any) => ({
    scopedFindByIdOrThrow: jest.fn().mockResolvedValue(row),
    scopedFind: jest.fn(),
  });
  const scopedDeny = () => ({
    scopedFindByIdOrThrow: jest
      .fn()
      .mockRejectedValue(new NotFoundException('Notice not found')),
    scopedFind: jest.fn(),
  });

  // ── GET /notices/:id (READ) ──────────────────────────────────────────────
  describe('findById (GET /notices/:id)', () => {
    it('cross-tenant: scoped layer denies → 404; wall + hydration NEVER reached', async () => {
      const noticeRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedDeny();
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      await expect(svc.findById(NOTICE_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // S2e re-aim: denial fires at the SCOPED layer (consulted first).
      expect(noticeScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        NOTICE_IN_B,
        ORG_A,
      );
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(noticeRepo.findOne).not.toHaveBeenCalled();
    });

    it('in-org: returns the notice — BOTH layers consulted, hydration on the validated id', async () => {
      const noticeRepo = { findOne: jest.fn().mockResolvedValue(orgBNotice()) };
      const contractAccess = { findInOrg: resolve() };
      const noticeScoped = scopedResolve(orgBNotice());
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      const result = await svc.findById(NOTICE_IN_B, ORG_A);
      expect(result.id).toBe(NOTICE_IN_B);
      // Layer 2 — scoped tenancy load.
      expect(noticeScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        NOTICE_IN_B,
        ORG_A,
      );
      // Layer 1 — the #57 wall STAYS, keyed on the scoped row's own contract_id.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404 (two layers, not a swap)', async () => {
      const noticeRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedResolve(orgBNotice());
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      await expect(svc.findById(NOTICE_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(noticeScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        NOTICE_IN_B,
        ORG_A,
      );
      // The wall fired (and denied) AFTER the scoped layer passed — load-bearing.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      // Hydration never runs because the wall denied first.
      expect(noticeRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── PUT /notices/:id/acknowledge (WRITE) ─────────────────────────────────
  describe('acknowledge (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the notice row is mutated', async () => {
      const noticeRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedDeny();
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      await expect(
        svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noticeScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        NOTICE_IN_B,
        ORG_A,
      );
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: acknowledges the notice', async () => {
      const noticeRepo = {
        findOne: jest.fn().mockResolvedValue(orgBNotice()),
        save: jest.fn(async (n: any) => n),
      };
      const noticeStatusLogRepo = { create: jest.fn((x) => x), save: jest.fn() };
      const contractAccess = { findInOrg: resolve() };
      const noticeScoped = scopedResolve(orgBNotice());
      const svc = build({
        noticeRepo,
        noticeStatusLogRepo,
        contractAccess,
        noticeScoped,
      });

      const result = await svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A);
      expect(result.status).toBe(NoticeStatus.ACKNOWLEDGED);
      expect(noticeRepo.save).toHaveBeenCalled();
    });
  });

  // ── POST /notices/:id/respond (WRITE) ────────────────────────────────────
  describe('respond (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the response row is created', async () => {
      const noticeRepo = { findOne: jest.fn(), save: jest.fn() };
      const noticeResponseRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedDeny();
      const svc = build({
        noticeRepo,
        noticeResponseRepo,
        contractAccess,
        noticeScoped,
      });

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
    it('cross-tenant: scoped denies → 404 BEFORE the status is changed', async () => {
      const noticeRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedDeny();
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

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
    it('the gate keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      // PermissionLevelGuard bypasses SYSTEM_ADMIN/OPERATIONS/OWNER_ADMIN at the
      // controller, but both the scoped load and the wall take only
      // (id/contractId, orgId) — there is NO role input either could honour. So
      // a bypass-role caller in ORG_A is still denied an ORG_B notice (the
      // denial now fires at the scoped layer).
      const noticeRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const noticeScoped = scopedDeny();
      const svc = build({ noticeRepo, contractAccess, noticeScoped });

      await expect(
        svc.acknowledge(NOTICE_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noticeScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        NOTICE_IN_B,
        ORG_A,
      );
      expect(noticeRepo.save).not.toHaveBeenCalled();
    });
  });
});
