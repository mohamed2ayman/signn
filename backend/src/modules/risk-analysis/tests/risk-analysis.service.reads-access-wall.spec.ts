import { NotFoundException } from '@nestjs/common';

import { RiskAnalysisService } from '../risk-analysis.service';

/**
 * Tenant-isolation — the two contractId-keyed READ endpoints on
 * RiskAnalysisController:
 *
 *   GET /risk-analysis/contract/:contractId          (getByContract)
 *   GET /risk-analysis/contract/:contractId/summary  (getRiskSummary)
 *
 * TWO CHECKS, TWO LAYERS (CLAUDE.md Option B):
 *   layer 1 — WALL: ContractAccessService.findInOrg (Tier 2 / #60) STAYS in
 *     front; cross-tenant probe → 404 before any data load.
 *   layer 2 — SCOPED REPO (Option B S2d): the per-contract risk LIST load goes
 *     through RiskScopedRepository.scopedFind (canonical
 *     risk→contract→project→org). The independent SQL org gate is proven
 *     against real Postgres in
 *     scoped-repository/tests/risk-scoped.s2d.repository.spec.ts.
 *
 * RE-AIM (S2d): pre-S2d both reads were a bare `riskRepo.find({ contract_id })`
 * AFTER the wall — the "find not called on cross-tenant" assertion proved only
 * layer 1. The bare find is now replaced by the scoped load (layer 2), so the
 * cross-tenant assertions move to `scopedFind not called`, and the happy paths
 * assert the scoped load runs with the CALLER org. getByContract uses the
 * minimal-scoped-then-hydrate two-step (its nested `contract_clause.clause`
 * relation exceeds scopedFind's single-level hydration) — the hydrate keys on
 * the tenancy-validated ids ONLY, never raw request input.
 */
describe('RiskAnalysisService — READ wall (layer 1) + S2d scoped data layer (layer 2)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-2222222222a2';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const noop = {} as any;

  function build({
    riskAnalysisRepository,
    contractAccess,
    riskScoped,
  }: {
    riskAnalysisRepository?: any;
    contractAccess: any;
    riskScoped?: any;
  }): RiskAnalysisService {
    // ctor: (riskRepo, riskRuleRepo, riskCategoryRepo, collabGateway,
    //        contractAccess, riskScoped). Only the risk repo, the wall, and
    //        the scoped repo are exercised by these reads.
    const Ctor: any = RiskAnalysisService;
    return new Ctor(
      riskAnalysisRepository ?? noop,
      noop, // riskRuleRepository
      noop, // riskCategoryRepository
      noop, // collaborationGateway
      contractAccess,
      riskScoped ?? noop,
    );
  }

  describe('getByContract (two-step: scoped ids → hydrate)', () => {
    it('cross-tenant: wall 404s BEFORE the scoped load AND the hydrate', async () => {
      const riskAnalysisRepository = { find: jest.fn() };
      const riskScoped = { scopedFind: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ riskAnalysisRepository, contractAccess, riskScoped });

      await expect(
        svc.getByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // BOTH layers are gated behind the wall — neither data path runs.
      expect(riskScoped.scopedFind).not.toHaveBeenCalled();
      expect(riskAnalysisRepository.find).not.toHaveBeenCalled();
    });

    it('in-org: scoped load runs with the caller org; hydrate keys on the validated ids', async () => {
      const scopedRows = [{ id: 'risk-1' }, { id: 'risk-2' }];
      const hydrated = [
        { id: 'risk-1', contract_clause: {} },
        { id: 'risk-2', contract_clause: {} },
      ];
      const riskScoped = {
        scopedFind: jest.fn().mockResolvedValue(scopedRows),
      };
      // Risk-tab rework — STEP 1: the hydrate is now a QueryBuilder (it orders
      // by the source document's priority two joins away). Capture the WHERE
      // ids to prove the tenancy-validated ids drive the hydrate.
      const whereSpy = jest.fn();
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn((sql: string, params: any) => {
          whereSpy(sql, params);
          return qb;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(hydrated),
      };
      const riskAnalysisRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ riskAnalysisRepository, contractAccess, riskScoped });

      const result = await svc.getByContract(CONTRACT_IN_A, ORG_A);

      // layer 1 wall + layer 2 scoped, both keyed on the caller org.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
      );
      // Hydrate is keyed on the tenancy-validated ids ONLY, never on the raw
      // contract_id.
      expect(whereSpy).toHaveBeenCalledWith('r.id IN (:...ids)', {
        ids: ['risk-1', 'risk-2'],
      });
      expect(result).toEqual(hydrated);
    });

    it('in-org with zero scoped rows: short-circuits to [] without hydrating', async () => {
      const riskScoped = { scopedFind: jest.fn().mockResolvedValue([]) };
      const riskAnalysisRepository = { find: jest.fn() };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ riskAnalysisRepository, contractAccess, riskScoped });

      const result = await svc.getByContract(CONTRACT_IN_A, ORG_A);
      expect(result).toEqual([]);
      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
      );
      expect(riskAnalysisRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('getRiskSummary (single scopedFind, in-memory counts)', () => {
    it('cross-tenant: wall 404s BEFORE the scoped load', async () => {
      const riskScoped = { scopedFind: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ contractAccess, riskScoped });

      await expect(
        svc.getRiskSummary(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(riskScoped.scopedFind).not.toHaveBeenCalled();
    });

    it('in-org: summary computed from the scoped rows (caller org)', async () => {
      const riskScoped = {
        scopedFind: jest.fn().mockResolvedValue([
          { risk_level: 'HIGH', status: 'OPEN', risk_category: 'X' },
          { risk_level: 'LOW', status: 'OPEN', risk_category: 'Y' },
        ]),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ contractAccess, riskScoped });

      const result = await svc.getRiskSummary(CONTRACT_IN_A, ORG_A);

      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
      );
      expect(result.total).toBe(2);
      expect(result.by_level).toEqual({ HIGH: 1, LOW: 1 });
    });
  });
});
