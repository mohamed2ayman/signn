import { NotFoundException } from '@nestjs/common';

import { SubContractsService } from '../subcontracts.service';
import { ContractStatus } from '../../../database/entities';

/**
 * Tenant-isolation Tier 3 — service-level access-wall spec for the
 * SubContractsService entry points that previously did a bare findOne
 * on `main_contract_id` (which IS a contract id — sub_contract.main_-
 * contract_id → contracts.id, confirmed at sub-contract.entity.ts:17):
 *
 *   - create                  (POST /subcontracts)
 *   - findAllByMainContract   (GET  /subcontracts?main_contract_id=)
 *
 * Cross-org → 404 (NOT 403, no existence leak); in-org → success.
 * The status-log side effect in create is gated by the wall.
 *
 * S2e RE-AIM: the LIST read (findAllByMainContract) now sources its rows from
 * the scoped chokepoint (SubContractScopedRepository.scopedFind — layer 2)
 * AFTER the Tier 3 findInOrg wall (layer 1, FIRST — also the status source).
 * The wall stays the first gate; a cross-tenant probe is still denied by the
 * WALL before scopedFind is reached. The in-org assertion moved from the bare
 * subContractRepo.find to scopedFind. create() is UNCHANGED (wall-only stop-gap).
 */
describe('SubContractsService — cross-tenant access wall (Tier 3 → S2e scoped list)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  type Builder = {
    subContractRepo?: any;
    statusLogRepo?: any;
    contractRepo?: any;
    contractAccess: any;
    subContractScoped?: any;
  };

  function build(opts: Builder): SubContractsService {
    // `any`-cast Ctor — the scoped repo is appended as the last constructor arg.
    const Ctor: any = SubContractsService;
    return new Ctor(
      opts.subContractRepo ?? noop,
      opts.statusLogRepo ?? noop,
      opts.contractRepo ?? noop,
      opts.contractAccess,
      opts.subContractScoped ?? { scopedFind: jest.fn().mockResolvedValue([]) },
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = { id: CONTRACT_IN_A, status: ContractStatus.ACTIVE }) =>
    jest.fn().mockResolvedValue(val);

  // ────────────────────────────────────────────────────────────────────
  // create — POST /subcontracts
  // ────────────────────────────────────────────────────────────────────
  describe('create (POST /subcontracts)', () => {
    it('cross-tenant: 404 BEFORE any subcontract row or status log is touched', async () => {
      const subContractRepo = {
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const statusLogRepo = { create: jest.fn(), save: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ subContractRepo, statusLogRepo, contractAccess });

      await expect(
        svc.create(
          {
            main_contract_id: CONTRACT_IN_B, // foreign main contract
            subcontractor_name: 'x',
          } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Wall is keyed on main_contract_id, not URL — confirmed.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.count).not.toHaveBeenCalled();
      expect(subContractRepo.create).not.toHaveBeenCalled();
      expect(subContractRepo.save).not.toHaveBeenCalled();
      expect(statusLogRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, subcontract row saved with auto-numbered ref', async () => {
      const subContractRepo = {
        count: jest.fn().mockResolvedValue(4),
        create: jest.fn((entity: any) => entity),
        save: jest.fn(async (entity: any) => ({ ...entity, id: 'new-sub' })),
      };
      const statusLogRepo = {
        create: jest.fn((e: any) => e),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ subContractRepo, statusLogRepo, contractAccess });

      const result = await svc.create(
        {
          main_contract_id: CONTRACT_IN_A,
          subcontractor_name: 'x',
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
          main_contract_id: CONTRACT_IN_A,
          subcontract_number: 'SC-005',
          created_by: USER_ID,
          org_id: ORG_A,
          status: ContractStatus.DRAFT,
        }),
      );
      expect(statusLogRepo.save).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // findAllByMainContract — GET /subcontracts?main_contract_id=
  // ────────────────────────────────────────────────────────────────────
  describe('findAllByMainContract (GET /subcontracts?main_contract_id=)', () => {
    it('cross-tenant: wall 404s FIRST — scoped list never runs', async () => {
      const subContractRepo = { find: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const subContractScoped = { scopedFind: jest.fn() };

      const svc = build({ subContractRepo, contractAccess, subContractScoped });

      await expect(
        svc.findAllByMainContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.find).not.toHaveBeenCalled();
      expect(subContractScoped.scopedFind).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, subcontracts returned from the scoped list (layer 2)', async () => {
      const SUBS = [
        { id: 's1', main_contract_id: CONTRACT_IN_A },
        { id: 's2', main_contract_id: CONTRACT_IN_A },
      ];
      const subContractRepo = { find: jest.fn() };
      const contractAccess = { findInOrg: resolve() };
      const subContractScoped = { scopedFind: jest.fn().mockResolvedValue(SUBS) };

      const svc = build({ subContractRepo, contractAccess, subContractScoped });
      const result = await svc.findAllByMainContract(CONTRACT_IN_A, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      // Layer 2 — the scoped chokepoint sourced the rows. The `mainContract`
      // relation hydrates beside the gate join (distinct org_gate_main_contract
      // alias). The bare repo find is no longer used.
      expect(subContractScoped.scopedFind).toHaveBeenCalledWith(
        { main_contract_id: CONTRACT_IN_A },
        ORG_A,
        { relations: ['creator', 'mainContract'], order: { created_at: 'DESC' } },
      );
      expect(subContractRepo.find).not.toHaveBeenCalled();
      expect(result).toEqual(SUBS);
    });
  });
});
