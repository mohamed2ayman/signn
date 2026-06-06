import { NotFoundException } from '@nestjs/common';

import { RiskAnalysisService } from '../risk-analysis.service';

/**
 * Tenant-isolation Tier 2 — access-wall spec for the two contractId-keyed
 * READ endpoints on RiskAnalysisController:
 *
 *   GET /risk-analysis/contract/:contractId          (getByContract)
 *   GET /risk-analysis/contract/:contractId/summary  (getRiskSummary)
 *
 * Pre-fix both bypassed contract ownership entirely — bare `.find({
 * contract_id })` with no org filter.
 */
describe('RiskAnalysisService — Tier 2 READ access wall', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const noop = {} as any;

  function build({
    riskAnalysisRepository,
    contractAccess,
  }: {
    riskAnalysisRepository?: any;
    contractAccess: any;
  }): RiskAnalysisService {
    return new RiskAnalysisService(
      riskAnalysisRepository ?? noop,
      noop, // riskRuleRepository
      noop, // riskCategoryRepository
      noop, // collaborationGateway
      contractAccess,
    );
  }

  describe('getByContract', () => {
    it('cross-tenant: 404 BEFORE the find runs', async () => {
      const riskAnalysisRepository = { find: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ riskAnalysisRepository, contractAccess });

      await expect(
        svc.getByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(riskAnalysisRepository.find).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, rows returned', async () => {
      const rows = [{ id: 'risk-1' }];
      const riskAnalysisRepository = {
        find: jest.fn().mockResolvedValue(rows),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ riskAnalysisRepository, contractAccess });

      const result = await svc.getByContract('contract-in-a', ORG_A);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(result).toEqual(rows);
    });
  });

  describe('getRiskSummary', () => {
    it('cross-tenant: 404 BEFORE the find runs', async () => {
      const riskAnalysisRepository = { find: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ riskAnalysisRepository, contractAccess });

      await expect(
        svc.getRiskSummary(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(riskAnalysisRepository.find).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, summary computed', async () => {
      const riskAnalysisRepository = {
        find: jest.fn().mockResolvedValue([
          { risk_level: 'HIGH', status: 'OPEN', risk_category: 'X' },
          { risk_level: 'LOW', status: 'OPEN', risk_category: 'Y' },
        ]),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ riskAnalysisRepository, contractAccess });

      const result = await svc.getRiskSummary('contract-in-a', ORG_A);
      expect(result.total).toBe(2);
      expect(result.by_level).toEqual({ HIGH: 1, LOW: 1 });
    });
  });
});
