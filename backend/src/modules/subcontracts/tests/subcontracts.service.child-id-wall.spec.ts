import { NotFoundException } from '@nestjs/common';

import { SubContractsService } from '../subcontracts.service';
import { ContractStatus } from '../../../database/entities/contract.entity';

/**
 * S0-part-2 — child-id cross-tenant wall spec for the SubContractsService :id
 * routes.
 *
 * Tier 3 (#52) walled create + findAllByMainContract; it MISSED the :id routes
 * (findById, update, updateStatus, share) — they took no orgId and never called
 * findInOrg, so an org-A caller could read/mutate an org-B sub-contract by its
 * id (proven by the STEP-0 red-before exploit, since deleted). A sub-contract
 * resolves to its org via its OWN main_contract_id (a real contract id).
 *
 * Cross-tenant → 404 (NOT 403, no existence leak); in-org → success.
 */
describe('SubContractsService — child-id cross-tenant wall (S0-part-2)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const SUBCONTRACT_IN_B = '44444444-4444-4444-4444-4444444444b4';
  const MAIN_CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  function build(opts: {
    subContractRepo?: any;
    statusLogRepo?: any;
    contractAccess: any;
  }): SubContractsService {
    return new SubContractsService(
      opts.subContractRepo ?? noop,
      opts.statusLogRepo ?? noop,
      noop,
      opts.contractAccess,
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = () =>
    jest.fn().mockResolvedValue({ id: MAIN_CONTRACT_IN_B, status: ContractStatus.ACTIVE });

  const orgBSub = () => ({
    id: SUBCONTRACT_IN_B,
    main_contract_id: MAIN_CONTRACT_IN_B, // main contract belongs to ORG B
    status: ContractStatus.DRAFT,
  });

  // ── GET /subcontracts/:id (READ) ─────────────────────────────────────────
  describe('findById (GET /subcontracts/:id)', () => {
    it('cross-tenant: 404 — wall keyed on the sub-contract OWN main_contract_id', async () => {
      const subContractRepo = { findOne: jest.fn().mockResolvedValue(orgBSub()) };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ subContractRepo, contractAccess });

      await expect(svc.findById(SUBCONTRACT_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // child→real-parent proof: walled with the sub-contract's OWN main_contract_id.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('in-org: returns the sub-contract', async () => {
      const subContractRepo = { findOne: jest.fn().mockResolvedValue(orgBSub()) };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ subContractRepo, contractAccess });

      const result = await svc.findById(SUBCONTRACT_IN_B, ORG_A);
      expect(result.id).toBe(SUBCONTRACT_IN_B);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
    });
  });

  // ── PUT /subcontracts/:id (WRITE) ────────────────────────────────────────
  describe('update (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the sub-contract is mutated', async () => {
      const subContractRepo = {
        findOne: jest.fn().mockResolvedValue(orgBSub()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ subContractRepo, contractAccess });

      await expect(
        svc.update(SUBCONTRACT_IN_B, { subcontractor_name: 'HIJACKED' } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: updates the sub-contract', async () => {
      const subContractRepo = {
        findOne: jest.fn().mockResolvedValue(orgBSub()),
        save: jest.fn(async (s: any) => s),
      };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ subContractRepo, contractAccess });

      const result = await svc.update(
        SUBCONTRACT_IN_B,
        { subcontractor_name: 'Legit Co' } as any,
        USER_A,
        ORG_A,
      );
      expect((result as any).subcontractor_name).toBe('Legit Co');
      expect(subContractRepo.save).toHaveBeenCalled();
    });
  });

  // ── PUT /subcontracts/:id/status (WRITE) ─────────────────────────────────
  describe('updateStatus (WRITE)', () => {
    it('cross-tenant: 404 BEFORE the status is changed', async () => {
      const subContractRepo = {
        findOne: jest.fn().mockResolvedValue(orgBSub()),
        save: jest.fn(),
      };
      const statusLogRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ subContractRepo, statusLogRepo, contractAccess });

      await expect(
        svc.updateStatus(SUBCONTRACT_IN_B, { status: ContractStatus.ACTIVE } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── POST /subcontracts/:id/share (WRITE) ─────────────────────────────────
  describe('share (WRITE)', () => {
    it('cross-tenant: 404 BEFORE a share token is minted', async () => {
      const subContractRepo = { findOne: jest.fn().mockResolvedValue(orgBSub()) };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ subContractRepo, contractAccess });

      await expect(
        svc.share(SUBCONTRACT_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('in-org: returns a share url + token', async () => {
      const subContractRepo = { findOne: jest.fn().mockResolvedValue(orgBSub()) };
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ subContractRepo, contractAccess });

      const result = await svc.share(SUBCONTRACT_IN_B, USER_A, ORG_A);
      expect(result.token).toEqual(expect.any(String));
      expect(result.shareUrl).toContain(result.token);
    });
  });

  // ── Bypass-role probe ────────────────────────────────────────────────────
  describe('role-agnostic wall (PLG bypass-role probe)', () => {
    it('the wall keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      const subContractRepo = {
        findOne: jest.fn().mockResolvedValue(orgBSub()),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };
      const svc = build({ subContractRepo, contractAccess });

      await expect(
        svc.update(SUBCONTRACT_IN_B, { subcontractor_name: 'x' } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });
  });
});
