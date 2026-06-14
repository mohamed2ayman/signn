import { NotFoundException } from '@nestjs/common';

import { RiskAnalysisService } from '../risk-analysis.service';

/**
 * Tenant-isolation — pre-S2e stop-gap walls on the two RiskAnalysisService
 * paths S2d's recon surfaced as still-open cross-tenant gaps:
 *
 *   PUT /risk-analysis/:id/status        (updateRiskStatus — by-id WRITE)
 *   GET /risk-analysis/clause/:clauseId  (getByClause — clause-keyed READ)
 *
 * These are NOT scoped-repository conversions (getExplanation / applyOverride
 * centralization is parked). They are the SAME stop-gap shape as the #65
 * create() wall: thread the caller org in and gate on
 * ContractAccessService.findInOrg (canonical contract→project→org; 404 — never
 * 403 — on miss, so existence is never leaked) BEFORE the mutation / before
 * the rows are returned.
 *
 * RED FORM (proven against unwalled main before the wall landed):
 *   - updateRiskStatus: an org-A caller mutates an org-B risk row — the foreign
 *     row is saved + a realtime event emitted (no findInOrg in the path).
 *   - getByClause: an org-A caller reads an org-B clause's risk rows and the
 *     foreign rows are returned (no findInOrg in the path).
 * The `(svc as any)` cast keeps this spec compiling across the orgId-threading
 * signature change, exactly as the #65 spec did.
 */
describe('RiskAnalysisService — pre-S2e access walls (updateRiskStatus WRITE + getByClause READ)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-2222222222a2';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const RISK_ID = '33333333-3333-3333-3333-333333333333';
  const CLAUSE_ID = '44444444-4444-4444-4444-444444444444';
  const USER_ID = '55555555-5555-5555-5555-555555555555';
  const noop = {} as any;

  function build({
    riskAnalysisRepository,
    collaborationGateway,
    contractAccess,
  }: {
    riskAnalysisRepository?: any;
    collaborationGateway?: any;
    contractAccess: any;
  }): RiskAnalysisService {
    // ctor: (riskRepo, riskRuleRepo, riskCategoryRepo, collabGateway,
    //        contractAccess, riskScoped). Only the risk repo, the collab
    //        gateway, and the wall are exercised by these two paths.
    const Ctor: any = RiskAnalysisService;
    return new Ctor(
      riskAnalysisRepository ?? noop,
      noop, // riskRuleRepository
      noop, // riskCategoryRepository
      collaborationGateway ?? noop,
      contractAccess,
      noop, // riskScoped (S2d) — untouched by these stop-gap walls
    );
  }

  describe('updateRiskStatus (by-id WRITE)', () => {
    it('cross-tenant: wall 404s on the loaded row org and NOTHING is mutated (no save, no emit)', async () => {
      const foreignRisk = {
        id: RISK_ID,
        contract_id: CONTRACT_IN_B,
        status: 'OPEN',
      };
      const riskAnalysisRepository = {
        findOne: jest.fn().mockResolvedValue(foreignRisk),
        save: jest.fn(),
      };
      const collaborationGateway = { emitRiskUpdated: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({
        riskAnalysisRepository,
        collaborationGateway,
        contractAccess,
      });

      await expect(
        (svc as any).updateRiskStatus(
          RISK_ID,
          { status: 'APPROVED' },
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Wall fires on the loaded row's contract_id, keyed on the caller org.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // The foreign row is NEVER written and NO realtime event leaks out.
      expect(riskAnalysisRepository.save).not.toHaveBeenCalled();
      expect(collaborationGateway.emitRiskUpdated).not.toHaveBeenCalled();
    });

    it('in-org: wall passes, status is mutated + saved + the realtime event is emitted', async () => {
      const ownRisk = {
        id: RISK_ID,
        contract_id: CONTRACT_IN_A,
        status: 'OPEN',
      };
      const riskAnalysisRepository = {
        findOne: jest.fn().mockResolvedValue(ownRisk),
        save: jest.fn().mockImplementation(async (r: any) => r),
      };
      const collaborationGateway = { emitRiskUpdated: jest.fn() };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({
        riskAnalysisRepository,
        collaborationGateway,
        contractAccess,
      });

      const result = await (svc as any).updateRiskStatus(
        RISK_ID,
        { status: 'APPROVED' },
        USER_ID,
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(riskAnalysisRepository.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('APPROVED');
      expect(result.handled_by).toBe(USER_ID);
      expect(collaborationGateway.emitRiskUpdated).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        expect.objectContaining({ contractId: CONTRACT_IN_A }),
      );
    });

    it('nonexistent risk: 404 before the wall is ever consulted', async () => {
      const riskAnalysisRepository = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
      };
      const collaborationGateway = { emitRiskUpdated: jest.fn() };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({
        riskAnalysisRepository,
        collaborationGateway,
        contractAccess,
      });

      await expect(
        (svc as any).updateRiskStatus(
          RISK_ID,
          { status: 'APPROVED' },
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(riskAnalysisRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getByClause (clause-keyed READ)', () => {
    it("cross-tenant: wall 404s on the rows' contract_id; foreign rows are never returned", async () => {
      // All rows for one contract_clause_id share one contract_id (a clause
      // belongs to exactly one contract), so the wall gates the whole result.
      const foreignRows = [
        { id: 'r1', contract_id: CONTRACT_IN_B, contract_clause_id: CLAUSE_ID },
        { id: 'r2', contract_id: CONTRACT_IN_B, contract_clause_id: CLAUSE_ID },
      ];
      const riskAnalysisRepository = {
        find: jest.fn().mockResolvedValue(foreignRows),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ riskAnalysisRepository, contractAccess });

      await expect(
        (svc as any).getByClause(CLAUSE_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('in-org: wall passes, the clause risk rows are returned', async () => {
      const ownRows = [
        { id: 'r1', contract_id: CONTRACT_IN_A, contract_clause_id: CLAUSE_ID },
      ];
      const riskAnalysisRepository = {
        find: jest.fn().mockResolvedValue(ownRows),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ riskAnalysisRepository, contractAccess });

      const result = await (svc as any).getByClause(CLAUSE_ID, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(result).toEqual(ownRows);
    });

    it('clause with no risk rows: short-circuits to [] without consulting the wall', async () => {
      const riskAnalysisRepository = {
        find: jest.fn().mockResolvedValue([]),
      };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({ riskAnalysisRepository, contractAccess });

      const result = await (svc as any).getByClause(CLAUSE_ID, ORG_A);

      expect(result).toEqual([]);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });
  });
});
