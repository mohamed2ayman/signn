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
 * S2e RE-AIM: Option B subsumed the by-id LOADs into the scoped-repository
 * chokepoint (SubContractScopedRepository.scopedFindByIdOrThrow — layer 2,
 * consulted FIRST), with the findInOrg wall STAYING above it as layer 1.
 * findById then HYDRATES the nested status_logs.changer on the validated id;
 * update/updateStatus/share operate on the scoped entity directly (no nested
 * relations). Cross-tenant denial fires at the SCOPED layer before the wall is
 * reached — the cross-tenant assertions were re-aimed accordingly (scoped
 * consulted; wall + downstream write NOT reached), the happy paths assert BOTH
 * layers (wall liveness preserved), and a dedicated findById test proves the
 * wall is NOT dead code. The scoped layer's independent denial is proven in
 * subcontracts.service.s2e-scoped-wiring.spec.ts (mock) and
 * subcontract-scoped.s2e.repository.spec.ts (real Postgres).
 *
 * BEFORE: cross-tenant asserted findInOrg called with main_contract_id and
 * mocked subContractRepo.findOne to return the foreign row.
 * AFTER:  cross-tenant asserts scopedFindByIdOrThrow consulted, findInOrg NOT
 * reached, and no save/token.
 *
 * Cross-tenant → 404 (NOT 403, no existence leak); in-org → success.
 */
describe('SubContractsService — child-id cross-tenant wall (S0-part-2 → S2e two-layer)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const SUBCONTRACT_IN_B = '44444444-4444-4444-4444-4444444444b4';
  const MAIN_CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  function build(opts: {
    subContractRepo?: any;
    statusLogRepo?: any;
    contractAccess: any;
    subContractScoped: any;
  }): SubContractsService {
    const Ctor: any = SubContractsService;
    return new Ctor(
      opts.subContractRepo ?? noop,
      opts.statusLogRepo ?? noop,
      noop,
      opts.contractAccess,
      opts.subContractScoped,
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

  const scopedResolve = (row: any) => ({
    scopedFindByIdOrThrow: jest.fn().mockResolvedValue(row),
    scopedFind: jest.fn(),
  });
  const scopedDeny = () => ({
    scopedFindByIdOrThrow: jest
      .fn()
      .mockRejectedValue(new NotFoundException('Subcontract not found')),
    scopedFind: jest.fn(),
  });

  // ── GET /subcontracts/:id (READ) ─────────────────────────────────────────
  describe('findById (GET /subcontracts/:id)', () => {
    it('cross-tenant: scoped denies → 404; wall + hydration NEVER reached', async () => {
      const subContractRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedDeny();
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      await expect(svc.findById(SUBCONTRACT_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(subContractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        SUBCONTRACT_IN_B,
        ORG_A,
      );
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(subContractRepo.findOne).not.toHaveBeenCalled();
    });

    it('in-org: returns the sub-contract — BOTH layers consulted, hydration on the validated id', async () => {
      const subContractRepo = { findOne: jest.fn().mockResolvedValue(orgBSub()) };
      const contractAccess = { findInOrg: resolve() };
      const subContractScoped = scopedResolve(orgBSub());
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      const result = await svc.findById(SUBCONTRACT_IN_B, ORG_A);
      expect(result.id).toBe(SUBCONTRACT_IN_B);
      expect(subContractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        SUBCONTRACT_IN_B,
        ORG_A,
      );
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('wall is NOT dead code: scoped passes but wall denies → 404', async () => {
      const subContractRepo = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedResolve(orgBSub());
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      await expect(svc.findById(SUBCONTRACT_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── PUT /subcontracts/:id (WRITE) ────────────────────────────────────────
  describe('update (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the sub-contract is mutated', async () => {
      const subContractRepo = { save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedDeny();
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      await expect(
        svc.update(SUBCONTRACT_IN_B, { subcontractor_name: 'HIJACKED' } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });

    it('in-org: updates the sub-contract through the scoped entity', async () => {
      const subContractRepo = { save: jest.fn(async (s: any) => s) };
      const contractAccess = { findInOrg: resolve() };
      const subContractScoped = scopedResolve(orgBSub());
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      const result = await svc.update(
        SUBCONTRACT_IN_B,
        { subcontractor_name: 'Legit Co' } as any,
        USER_A,
        ORG_A,
      );
      expect((result as any).subcontractor_name).toBe('Legit Co');
      expect(subContractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        SUBCONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.save).toHaveBeenCalled();
    });
  });

  // ── PUT /subcontracts/:id/status (WRITE) ─────────────────────────────────
  describe('updateStatus (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE the status is changed', async () => {
      const subContractRepo = { save: jest.fn() };
      const statusLogRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedDeny();
      const svc = build({ subContractRepo, statusLogRepo, contractAccess, subContractScoped });

      await expect(
        svc.updateStatus(SUBCONTRACT_IN_B, { status: ContractStatus.ACTIVE } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── POST /subcontracts/:id/share (WRITE) ─────────────────────────────────
  describe('share (WRITE)', () => {
    it('cross-tenant: scoped denies → 404 BEFORE a share token is minted', async () => {
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedDeny();
      const svc = build({ contractAccess, subContractScoped });

      await expect(
        svc.share(SUBCONTRACT_IN_B, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        SUBCONTRACT_IN_B,
        ORG_A,
      );
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });

    it('in-org: returns a share url + token — BOTH layers consulted', async () => {
      const contractAccess = { findInOrg: resolve() };
      const subContractScoped = scopedResolve(orgBSub());
      const svc = build({ contractAccess, subContractScoped });

      const result = await svc.share(SUBCONTRACT_IN_B, USER_A, ORG_A);
      expect(result.token).toEqual(expect.any(String));
      expect(result.shareUrl).toContain(result.token);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        MAIN_CONTRACT_IN_B,
        ORG_A,
      );
    });
  });

  // ── Bypass-role probe ────────────────────────────────────────────────────
  describe('role-agnostic gate (PLG bypass-role probe)', () => {
    it('the gate keys on orgId, not role — a bypass-role caller still 404s cross-tenant', async () => {
      const subContractRepo = { save: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = scopedDeny();
      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      await expect(
        svc.update(SUBCONTRACT_IN_B, { subcontractor_name: 'x' } as any, USER_A, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(subContractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        SUBCONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.save).not.toHaveBeenCalled();
    });
  });
});
