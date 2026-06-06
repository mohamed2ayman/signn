import { NotFoundException } from '@nestjs/common';

import { ObligationsService } from '../obligations.service';

/**
 * Tenant-isolation Tier 2 — access-wall spec for the `?contract_id=`
 * conditional filter on `GET /obligations/dashboard`.
 *
 * The sibling route `GET /obligations/contract/:contractId` is
 * PLG-entangled (Class-C bypass-role leak; see
 * docs/tenant-isolation-tier2.md) and intentionally NOT walled here —
 * it folds into the Option B guard-architecture decision.
 */
describe('ObligationsService — Tier 2 dashboard access wall', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const noop = {} as any;

  function build({
    obligationRepository,
    contractAccess,
  }: {
    obligationRepository?: any;
    contractAccess: any;
  }): ObligationsService {
    return new ObligationsService(obligationRepository ?? noop, contractAccess);
  }

  describe('getDashboard (with contract_id supplied)', () => {
    it('cross-tenant: 404 BEFORE the qb runs', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ obligationRepository, contractAccess });

      await expect(
        svc.getDashboard(ORG_A, CONTRACT_IN_B),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(obligationRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller with contract_id, dashboard runs', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ obligationRepository, contractAccess });

      const result = await svc.getDashboard(ORG_A, 'contract-in-a');
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(result.total).toBe(0);
    });
  });

  describe('getDashboard (no contract_id — org-wide path)', () => {
    it('does NOT call findInOrg (no contract scope to check); qb runs unfiltered', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({ obligationRepository, contractAccess });

      await svc.getDashboard(ORG_A);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      // qb.where is only called when contract_id is supplied; in the
      // org-wide path it remains untouched.
      expect(qb.where).not.toHaveBeenCalled();
    });
  });
});
