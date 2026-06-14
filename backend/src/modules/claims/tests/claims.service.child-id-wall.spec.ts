import { NotFoundException } from '@nestjs/common';

import { ClaimsService } from '../claims.service';
import { ClaimStatus } from '../../../database/entities/claim.entity';

/**
 * S0-part-2 — child-id cross-tenant wall spec for the ClaimsService :id routes.
 *
 * Tier 3 (#52) walled create + findAllByContract; it MISSED the :id routes
 * (findById, acknowledge, respond, updateStatus, uploadDocument) — they took no
 * orgId and never called findInOrg, so an org-A caller could read/mutate an
 * org-B claim by its id (proven by the STEP-0 red-before exploit, since deleted).
 * These routes were #57-walled via the claim's OWN parent contract_id.
 *
 * S2e RE-AIM: Option B subsumed the by-id LOADs into the scoped-repository
 * chokepoint (ClaimScopedRepository.scopedFindByIdOrThrow — layer 2, consulted
 * FIRST), with the findInOrg wall STAYING above it as layer 1 and the trailing
 * findOne now a HYDRATION on the validated id. Cross-tenant denial therefore
 * fires at the SCOPED layer before the wall/hydration are reached — the
 * cross-tenant assertions were re-aimed accordingly (scoped consulted; wall +
 * downstream write NOT reached), the happy paths assert BOTH layers (wall
 * liveness preserved), and a dedicated findById test proves the wall is NOT
 * dead code (scoped passes, wall denies → 404). The scoped layer's independent
 * denial is proven in claims.service.s2e-scoped-wiring.spec.ts (mock) and
 * claim-scoped.s2e.repository.spec.ts (real Postgres).
 *
 * BEFORE: cross-tenant asserted findInOrg called with the claim's contract_id
 * and mocked claimRepo.findOne to return the foreign row.
 * AFTER:  cross-tenant asserts scopedFindByIdOrThrow consulted, findInOrg NOT
 * reached, and no downstream save/create.
 *
 * findById is the shared loader; acknowledge/respond/updateStatus inherit it.
 * uploadDocument loads the claim directly, so it carries its own scoped load.
 */
describe('ClaimsService — child-id cross-tenant wall (S0-part-2 → S2e two-layer)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CLAIM_IN_B = '33333333-3333-3333-3333-3333333333b3';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  function build(opts: {
    claimRepo?: any;
    claimDocumentRepo?: any;
    claimResponseRepo?: any;
    claimStatusLogRepo?: any;
    contractAccess: any;
    claimScoped: any;
  }): ClaimsService {
    const Ctor: any = ClaimsService;
    return new Ctor(
      opts.claimRepo ?? noop,
      opts.claimDocumentRepo ?? noop,
      opts.claimResponseRepo ?? noop,
      opts.claimStatusLogRepo ?? noop,
      noop,
      opts.contractAccess,
      opts.claimScoped,
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = () =>
    jest.fn().mockResolvedValue({ id: CONTRACT_IN_B, status: 'ACTIVE' });

  const orgBClaim = () => ({
    id: CLAIM_IN_B,
    contract_id: CONTRACT_IN_B, // belongs to ORG B
    status: ClaimStatus.SUBMITTED,
  });

  const scopedResolve = (row: any) => ({
    scopedFindByIdOrThrow: jest.fn().mockResolvedValue(row),
    scopedFind: jest.fn(),
  });
  const scopedDeny = () => ({
    scopedFindByIdOrThrow: jest
      .fn()
      .mockRejectedValue(new NotFoundException('Claim not found')),
    scopedFind: jest.fn(),
  });

  // ── GET /claims/:id (READ) ───────────────────────────────────────────────
  describe('findById (GET /claims/:id)', () => {
    it('cross-tenant: scoped denies → 404; wall + hydration NEVER reached', async () => {
      const claimRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(svc.findById(CLAIM_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(claimScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CLAIM_IN_B, ORG_A);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(claimRepo.findOne).not.toHaveBeenCalled();
    });

    it('in-org: returns the claim — BOTH layers consulted', async () => {
      const claimRepo = { findOne: jest.fn().mockResolvedValue(orgBClaim()) };
      const contractAccess = { findInOrg: resolve() };
      const claimScoped = scopedResolve(orgBClaim());
      const svc = build({ claimRepo, contractAccess, claimScoped });

      const result = await svc.findById(CLAIM_IN_B, ORG_A);
      expect(result.id).toBe(CLAIM_IN_B);
      expect(claimScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CLAIM_IN_B, ORG_A);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404', async () => {
      const claimRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedResolve(orgBClaim());
      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(svc.findById(CLAIM_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(claimRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── PUT /claims/:id/acknowledge (WRITE) ──────────────────────────────────
  describe('acknowledge (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the claim row is mutated', async () => {
      const claimRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(
        svc.acknowledge(CLAIM_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(claimRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: acknowledges the claim', async () => {
      const claimRepo = {
        findOne: jest.fn().mockResolvedValue(orgBClaim()),
        save: jest.fn(async (c: any) => c),
      };
      const claimStatusLogRepo = { create: jest.fn((x) => x), save: jest.fn() };
      const contractAccess = { findInOrg: resolve() };
      const claimScoped = scopedResolve(orgBClaim());
      const svc = build({ claimRepo, claimStatusLogRepo, contractAccess, claimScoped });

      const result = await svc.acknowledge(CLAIM_IN_B, USER_A, ORG_A);
      expect(result.status).toBe(ClaimStatus.ACKNOWLEDGED);
      expect(claimRepo.save).toHaveBeenCalled();
    });
  });

  // ── POST /claims/:id/respond (WRITE) ─────────────────────────────────────
  describe('respond (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the response row is created', async () => {
      const claimRepo = { findOne: jest.fn(), save: jest.fn() };
      const claimResponseRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimRepo, claimResponseRepo, contractAccess, claimScoped });

      await expect(
        svc.respond(
          CLAIM_IN_B,
          { response_type: 'REJECTED', response_content: 'x' } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(claimResponseRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── PUT /claims/:id/status (WRITE) ───────────────────────────────────────
  describe('updateStatus (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the status is changed', async () => {
      const claimRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(
        svc.updateStatus(
          CLAIM_IN_B,
          { status: ClaimStatus.REJECTED } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(claimRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── POST /claims/:id/documents (WRITE — own loader) ──────────────────────
  describe('uploadDocument (WRITE — carries its own scoped load)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the document row is created; wall NOT reached', async () => {
      const claimDocumentRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimDocumentRepo, contractAccess, claimScoped });

      await expect(
        svc.uploadDocument(
          CLAIM_IN_B,
          { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(claimScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CLAIM_IN_B, ORG_A);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(claimDocumentRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: uploads the document — BOTH layers consulted', async () => {
      const claimDocumentRepo = {
        create: jest.fn((x) => x),
        save: jest.fn(async (d: any) => ({ ...d, id: 'new-doc' })),
      };
      const contractAccess = { findInOrg: resolve() };
      const claimScoped = scopedResolve(orgBClaim());
      const svc = build({ claimDocumentRepo, contractAccess, claimScoped });

      const result = await svc.uploadDocument(
        CLAIM_IN_B,
        { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
        USER_A,
        ORG_A,
      );
      expect(result.id).toBe('new-doc');
      expect(claimScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CLAIM_IN_B, ORG_A);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(claimDocumentRepo.save).toHaveBeenCalled();
    });
  });

  // ── Bypass-role probe ────────────────────────────────────────────────────
  describe('role-agnostic gate (PLG bypass-role probe)', () => {
    it('the gate keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      const claimRepo = { findOne: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = scopedDeny();
      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(
        svc.acknowledge(CLAIM_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(claimScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CLAIM_IN_B, ORG_A);
      expect(claimRepo.save).not.toHaveBeenCalled();
    });
  });
});
