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

/**
 * Compliance truncation fix — backend half.
 *
 * The agent now returns a SALVAGED partial on truncation, labeled
 * `summary.incomplete = true`. This spec proves the backend half of the
 * contract:
 *   1. persistFindings stores the AI summary VERBATIM into findings_summary
 *      (the incomplete marker rides through with no mapping code), and a
 *      SHORTER-than-usual findings array persists without error — a salvaged
 *      partial is terminal SUCCESS (charge-on-salvage), not a failure.
 *   2. The FAILED branch now stores job.error into findings_summary.error —
 *      genuine failures stop being reasonless.
 */
describe('ComplianceService — truncation flag + failure reason', () => {
  let service: ComplianceService;

  const CHECK = 'check-aaaa';

  const checkRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const findingRepo = { find: jest.fn(), insert: jest.fn() };
  const aiService = {
    getJobStatus: jest.fn(),
    triggerExtractObligations: jest.fn(),
  };
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
    reservation_id: null, // metering helpers early-return on null
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
      ],
    }).compile();
    service = module.get(ComplianceService);
  });

  it('a salvaged-partial SUCCESS persists the shorter findings array and the incomplete marker rides findings_summary verbatim', async () => {
    const check = baseCheck();
    checkRepo.findOne.mockResolvedValue(check);
    checkRepo.save.mockImplementation(async (c) => c);
    findingRepo.insert.mockResolvedValue(undefined);
    aiService.triggerExtractObligations.mockResolvedValue({ job_id: 'obl-1' });
    aiService.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: {
        result: {
          findings: [
            {
              layer: 'JURISDICTION',
              finding_type: 'MISSING_CLAUSE',
              severity: 'CRITICAL',
              requirement: 'Decennial liability (Art 651)',
            },
          ],
          summary: {
            total: 1,
            by_layer: { JURISDICTION: 1 },
            by_severity: { CRITICAL: 1 },
            overall_status: 'NON_COMPLIANT',
            incomplete: true, // ← the salvage label from the agent
          },
        },
      },
    });

    await service.refreshFromAi(CHECK);

    // The single salvaged finding persisted — shorter array is fine.
    expect(findingRepo.insert).toHaveBeenCalledTimes(1);
    const rows = findingRepo.insert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('CRITICAL');

    // The incomplete marker landed in findings_summary VERBATIM.
    const savedWithSummary = checkRepo.save.mock.calls
      .map((c) => c[0])
      .find((c) => c.findings_summary);
    expect(savedWithSummary.findings_summary.incomplete).toBe(true);
    expect(savedWithSummary.overall_status).toBe('NON_COMPLIANT');
  });

  it('the FAILED branch stores job.error into findings_summary.error (no longer reasonless)', async () => {
    const check = baseCheck();
    checkRepo.findOne.mockResolvedValue(check);
    checkRepo.save.mockImplementation(async (c) => c);
    aiService.getJobStatus.mockResolvedValue({
      status: 'failed',
      error: 'Unterminated string starting at: line 1 column 9000',
    });

    await service.refreshFromAi(CHECK);

    const saved = checkRepo.save.mock.calls[0][0];
    expect(saved.overall_status).toBe('FAILED');
    expect(saved.findings_summary.error).toBe(
      'Unterminated string starting at: line 1 column 9000',
    );
    expect(findingRepo.insert).not.toHaveBeenCalled();
  });

  it('a FAILED job with no error string still stores a fallback reason', async () => {
    const check = baseCheck();
    checkRepo.findOne.mockResolvedValue(check);
    checkRepo.save.mockImplementation(async (c) => c);
    aiService.getJobStatus.mockResolvedValue({ status: 'failed' });

    await service.refreshFromAi(CHECK);

    const saved = checkRepo.save.mock.calls[0][0];
    expect(saved.findings_summary.error).toBe('AI compliance job failed');
  });
});
