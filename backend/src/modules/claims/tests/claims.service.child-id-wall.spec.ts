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
 * These routes now resolve the wall via the claim's OWN parent contract_id.
 *
 * Cross-tenant → 404 (NOT 403, no existence leak); in-org → success.
 * findById is the shared loader; acknowledge/respond/updateStatus inherit it.
 * uploadDocument loads the claim directly, so it carries its own wall.
 */
describe('ClaimsService — child-id cross-tenant wall (S0-part-2)', () => {
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
  }): ClaimsService {
    return new ClaimsService(
      opts.claimRepo ?? noop,
      opts.claimDocumentRepo ?? noop,
      opts.claimResponseRepo ?? noop,
      opts.claimStatusLogRepo ?? noop,
      noop,
      opts.contractAccess,
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

  // ── GET /claims/:id (READ) ───────────────────────────────────────────────
  describe('findById (GET /claims/:id)', () => {
    it('cross-tenant: 404 — wall keyed on the claim OWN contract_id', async () => {
      const claimRepo = { findOne: jest.fn().mockResolvedValue(orgBClaim()) };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, contractAccess });

      await expect(svc.findById(CLAIM_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });

    it('in-org: returns the claim', async () => {
      const claimRepo = { findOne: jest.fn().mockResolvedValue(orgBClaim()) };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ claimRepo, contractAccess });

      const result = await svc.findById(CLAIM_IN_B, ORG_A);
      expect(result.id).toBe(CLAIM_IN_B);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    });
  });

  // ── PUT /claims/:id/acknowledge (WRITE) ──────────────────────────────────
  describe('acknowledge (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the claim row is mutated', async () => {
      const claimRepo = {
        findOne: jest.fn().mockResolvedValue(orgBClaim()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, contractAccess });

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
      const svc = build({ claimRepo, claimStatusLogRepo, contractAccess });

      const result = await svc.acknowledge(CLAIM_IN_B, USER_A, ORG_A);
      expect(result.status).toBe(ClaimStatus.ACKNOWLEDGED);
      expect(claimRepo.save).toHaveBeenCalled();
    });
  });

  // ── POST /claims/:id/respond (WRITE) ─────────────────────────────────────
  describe('respond (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the response row is created', async () => {
      const claimRepo = {
        findOne: jest.fn().mockResolvedValue(orgBClaim()),
        save: jest.fn(),
      };
      const claimResponseRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, claimResponseRepo, contractAccess });

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
    it('cross-tenant: 404 BEFORE the status is changed', async () => {
      const claimRepo = {
        findOne: jest.fn().mockResolvedValue(orgBClaim()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, contractAccess });

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
  describe('uploadDocument (WRITE — carries its own wall)', () => {
    it('cross-tenant: 404 BEFORE the document row is created', async () => {
      const claimRepo = { findOne: jest.fn().mockResolvedValue(orgBClaim()) };
      const claimDocumentRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, claimDocumentRepo, contractAccess });

      await expect(
        svc.uploadDocument(
          CLAIM_IN_B,
          { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
          USER_A,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(claimDocumentRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: uploads the document', async () => {
      const claimRepo = { findOne: jest.fn().mockResolvedValue(orgBClaim()) };
      const claimDocumentRepo = {
        create: jest.fn((x) => x),
        save: jest.fn(async (d: any) => ({ ...d, id: 'new-doc' })),
      };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ claimRepo, claimDocumentRepo, contractAccess });

      const result = await svc.uploadDocument(
        CLAIM_IN_B,
        { file_url: 'http://x/y.pdf', file_name: 'y.pdf', document_type: 'EVIDENCE' } as any,
        USER_A,
        ORG_A,
      );
      expect(result.id).toBe('new-doc');
      expect(claimDocumentRepo.save).toHaveBeenCalled();
    });
  });

  // ── Bypass-role probe ────────────────────────────────────────────────────
  describe('role-agnostic wall (PLG bypass-role probe)', () => {
    it('the wall keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      const claimRepo = {
        findOne: jest.fn().mockResolvedValue(orgBClaim()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ claimRepo, contractAccess });

      await expect(
        svc.acknowledge(CLAIM_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(claimRepo.save).not.toHaveBeenCalled();
    });
  });
});
