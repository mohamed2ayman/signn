import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import { ComplianceService } from '../services/compliance.service';
import {
  ComplianceCheck,
  ComplianceFinding,
  ContractClause,
  KnowledgeAssetUsage,
  Project,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { MeteringService } from '../../metering/services/metering.service';
import { ComplianceKnowledgeService } from '../services/compliance-knowledge.service';
import { ComplianceObligationService } from '../services/compliance-obligation.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';
import { ComplianceCheckScopedRepository } from '../../scoped-repository/compliance-check-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale, 4 of 4): SERVICE-LAYER
 * wiring proof for ComplianceService's contract-scoped reads.
 *
 * The real-PG repo specs prove the scoped repos deny cross-org at the data layer
 * (the RED→GREEN data-layer probe). THIS spec proves the SERVICE actually ROUTES
 * its reads through those scoped repos (so the gate is reached) and threads the
 * caller's orgId — and that a scoped denial PROPAGATES to the caller:
 *   - listForContract → checkScoped.scopedFindAndCount({contract_id}, orgId)
 *   - getDetail       → checkScoped.scopedFindByIdOrThrow(checkId, orgId)
 *
 * RED FORM (stated): pre-wire these called `checkRepo.find/findOne` with NO org
 * filter; the bare repo is NOT consulted now (the wired reads route through the
 * scoped repo), so neither method can return a row the org gate would deny.
 */
describe('ComplianceService — Option B scoped wiring (finale)', () => {
  let service: ComplianceService;

  const ORG = 'org-aaaa';
  const CONTRACT = 'contract-aaaa';
  const CHECK = 'check-aaaa';

  const checkRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const findingRepo = { find: jest.fn(), insert: jest.fn() };
  const checkScoped = {
    scopedFindAndCount: jest.fn(),
    scopedFindByIdOrThrow: jest.fn(),
  };
  const contractScoped = { scopedFindByIdWithRelations: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: getRepositoryToken(ComplianceCheck), useValue: checkRepo },
        { provide: getRepositoryToken(ComplianceFinding), useValue: findingRepo },
        { provide: getRepositoryToken(Project), useValue: {} },
        { provide: getRepositoryToken(ContractClause), useValue: {} },
        { provide: getRepositoryToken(KnowledgeAssetUsage), useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: ComplianceKnowledgeService, useValue: {} },
        { provide: ComplianceObligationService, useValue: {} },
        { provide: MeteringService, useValue: {} },
        { provide: ContractScopedRepository, useValue: contractScoped },
        { provide: ComplianceCheckScopedRepository, useValue: checkScoped },
      ],
    }).compile();
    service = module.get(ComplianceService);
  });

  describe('listForContract', () => {
    it('routes through checkScoped.scopedFindAndCount with the orgId, returns the rows (count discarded)', async () => {
      checkScoped.scopedFindAndCount.mockResolvedValue([[{ id: CHECK }], 1]);

      const rows = await service.listForContract(CONTRACT, ORG);

      expect(checkScoped.scopedFindAndCount).toHaveBeenCalledWith(
        { contract_id: CONTRACT },
        ORG,
        { order: { created_at: 'DESC' }, take: 50 },
      );
      // The bare repo is NOT consulted for the wired LIST read.
      expect(checkRepo.find).not.toHaveBeenCalled();
      expect(rows).toEqual([{ id: CHECK }]);
    });
  });

  describe('getDetail', () => {
    it('routes the check load through checkScoped.scopedFindByIdOrThrow with the orgId; findings keyed by the validated id', async () => {
      checkScoped.scopedFindByIdOrThrow.mockResolvedValue({ id: CHECK });
      findingRepo.find.mockResolvedValue([{ id: 'f1' }]);

      const detail = await service.getDetail(CHECK, ORG);

      expect(checkScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CHECK, ORG);
      expect(findingRepo.find).toHaveBeenCalledWith({
        where: { compliance_check_id: CHECK },
        order: { severity: 'ASC', layer: 'ASC' },
      });
      // The bare repo is NOT consulted for the by-id check load.
      expect(checkRepo.findOne).not.toHaveBeenCalled();
      expect(detail).toMatchObject({ id: CHECK, findings: [{ id: 'f1' }] });
    });

    it('a scoped cross-org denial PROPAGATES (404) — findings are never read', async () => {
      checkScoped.scopedFindByIdOrThrow.mockRejectedValue(
        new NotFoundException('Compliance check not found'),
      );

      await expect(service.getDetail(CHECK, ORG)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findingRepo.find).not.toHaveBeenCalled();
    });
  });
});
