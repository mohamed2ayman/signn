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
 */
describe('SubContractsService — cross-tenant access wall (Tier 3)', () => {
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
  };

  function build(opts: Builder): SubContractsService {
    return new SubContractsService(
      opts.subContractRepo ?? noop,
      opts.statusLogRepo ?? noop,
      opts.contractRepo ?? noop,
      opts.contractAccess,
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
    it('cross-tenant: 404 BEFORE the subcontract list query runs', async () => {
      const subContractRepo = { find: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ subContractRepo, contractAccess });

      await expect(
        svc.findAllByMainContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(subContractRepo.find).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, subcontracts returned for the main contract', async () => {
      const SUBS = [
        { id: 's1', main_contract_id: CONTRACT_IN_A },
        { id: 's2', main_contract_id: CONTRACT_IN_A },
      ];
      const subContractRepo = { find: jest.fn().mockResolvedValue(SUBS) };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ subContractRepo, contractAccess });
      const result = await svc.findAllByMainContract(CONTRACT_IN_A, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(subContractRepo.find).toHaveBeenCalledWith({
        where: { main_contract_id: CONTRACT_IN_A },
        relations: ['creator', 'mainContract'],
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual(SUBS);
    });
  });
});
