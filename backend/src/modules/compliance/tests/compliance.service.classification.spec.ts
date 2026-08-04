import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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
import { PlaybookResolverService } from '../../playbook/playbook-resolver.service';

/**
 * 7.22 Item 2 — per-finding classification persistence + M/N denominator.
 *
 * persistFindings maps `classification` ONLY on PLAYBOOK-layer findings (MINOR /
 * MAJOR / NON_STANDARD via coerceEnumOrNull), null everywhere else (defense-in-
 * depth on top of the DB CHECK). The agent-emitted M/N counts ride
 * findings_summary verbatim (no backend mapping).
 */
describe('ComplianceService — Item 2 classification + M/N', () => {
  let service: ComplianceService;

  const CHECK = 'check-aaaa';
  const checkRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const findingRepo = { find: jest.fn(), insert: jest.fn() };
  const aiService = { getJobStatus: jest.fn(), triggerExtractObligations: jest.fn() };
  const playbookResolver = { filterExistingIds: jest.fn() };
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  const contractClauseRepo = { createQueryBuilder: jest.fn(() => qb) };

  const baseCheck = () => ({
    id: CHECK,
    contract_id: 'contract-aaaa',
    overall_status: 'PENDING',
    obligation_extraction_status: 'PENDING',
    ai_job_id: 'job-1',
    obligation_job_id: null,
    reservation_id: null,
    findings_summary: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: getRepositoryToken(ComplianceCheck), useValue: checkRepo },
        { provide: getRepositoryToken(ComplianceFinding), useValue: findingRepo },
        { provide: getRepositoryToken(Project), useValue: {} },
        { provide: getRepositoryToken(ContractClause), useValue: contractClauseRepo },
        { provide: getRepositoryToken(KnowledgeAssetUsage), useValue: {} },
        { provide: AiService, useValue: aiService },
        { provide: ComplianceKnowledgeService, useValue: {} },
        { provide: ComplianceObligationService, useValue: {} },
        { provide: MeteringService, useValue: {} },
        { provide: ContractScopedRepository, useValue: {} },
        { provide: ComplianceCheckScopedRepository, useValue: {} },
        { provide: PlaybookResolverService, useValue: playbookResolver },
      ],
    }).compile();
    service = module.get(ComplianceService);
  });

  it('classification: PLAYBOOK+position→MINOR, PLAYBOOK+null→NON_STANDARD, non-PLAYBOOK→null; M/N ride verbatim', async () => {
    const check = baseCheck();
    checkRepo.findOne.mockResolvedValue(check);
    checkRepo.save.mockImplementation(async (c) => c);
    findingRepo.insert.mockResolvedValue(undefined);
    aiService.triggerExtractObligations.mockResolvedValue({ job_id: 'obl-1' });
    // Only 'pos-1' is a real position → validates the first finding's echoed id.
    playbookResolver.filterExistingIds.mockResolvedValue(new Set(['pos-1']));
    aiService.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: {
        result: {
          findings: [
            {
              layer: 'PLAYBOOK',
              finding_type: 'PLAYBOOK_DEVIATION',
              severity: 'MEDIUM',
              requirement: 'r1',
              playbook_position_id: 'pos-1',
              classification: 'MINOR',
            },
            {
              layer: 'PLAYBOOK',
              finding_type: 'PLAYBOOK_DEVIATION',
              severity: 'LOW',
              requirement: 'r2',
              playbook_position_id: null,
              classification: 'NON_STANDARD',
            },
            {
              // non-PLAYBOOK with a stray classification — MUST be nulled.
              layer: 'STANDARD',
              finding_type: 'DEVIATION',
              severity: 'HIGH',
              requirement: 'r3',
              classification: 'MINOR',
            },
          ],
          summary: {
            total: 3,
            overall_status: 'PARTIALLY_COMPLIANT',
            playbook_status: 'MINOR_DEVIATIONS',
            playbook_relevant_count: 5,
            playbook_on_standard_count: 4,
          },
        },
      },
    });

    await service.refreshFromAi(CHECK);

    const rows = findingRepo.insert.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows[0].classification).toBe('MINOR'); // PLAYBOOK + valid position
    expect(rows[0].playbook_position_id).toBe('pos-1');
    expect(rows[1].classification).toBe('NON_STANDARD'); // PLAYBOOK + null position
    expect(rows[1].playbook_position_id).toBeNull();
    expect(rows[2].classification).toBeNull(); // non-PLAYBOOK → nulled (defense-in-depth)

    // M/N ride findings_summary verbatim (no backend mapping).
    const saved = checkRepo.save.mock.calls
      .map((c) => c[0])
      .find((c) => c.findings_summary);
    expect(saved.findings_summary.playbook_relevant_count).toBe(5);
    expect(saved.findings_summary.playbook_on_standard_count).toBe(4);
  });

  it('an invalid classification string on a PLAYBOOK finding coerces to null', async () => {
    const check = baseCheck();
    checkRepo.findOne.mockResolvedValue(check);
    checkRepo.save.mockImplementation(async (c) => c);
    findingRepo.insert.mockResolvedValue(undefined);
    aiService.triggerExtractObligations.mockResolvedValue({ job_id: 'obl-1' });
    playbookResolver.filterExistingIds.mockResolvedValue(new Set());
    aiService.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: {
        result: {
          findings: [
            {
              layer: 'PLAYBOOK',
              finding_type: 'PLAYBOOK_DEVIATION',
              severity: 'LOW',
              requirement: 'r',
              playbook_position_id: null,
              classification: 'NOT_A_TIER',
            },
          ],
          summary: { total: 1 },
        },
      },
    });

    await service.refreshFromAi(CHECK);

    const rows = findingRepo.insert.mock.calls[0][0];
    expect(rows[0].classification).toBeNull(); // invalid member → null
  });
});
