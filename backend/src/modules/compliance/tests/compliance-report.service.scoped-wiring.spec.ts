import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

import { ComplianceReportService } from '../services/compliance-report.service';
import {
  ComplianceReportJob,
  ComplianceReportType,
} from '../../../database/entities';
import { ComplianceCheckScopedRepository } from '../../scoped-repository/compliance-check-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale): SERVICE-LAYER wiring proof
 * for ComplianceReportService.request.
 *
 * request() loads the PARENT ComplianceCheck before queuing a report job. The
 * real-PG ComplianceCheck repo spec proves the data-layer denial; THIS spec
 * proves request() ROUTES that check load through checkScoped.scopedFindByIdOrThrow
 * (with the caller's orgId), that the bare ComplianceCheck repo is no longer
 * injected/consulted, and that a scoped cross-org denial PROPAGATES — no job row,
 * no queue add.
 *
 * RED FORM (stated): pre-wire request() called `checkRepo.findOne({ where: { id }})`
 * with NO org filter; with the wall neutralised a cross-org check would queue a
 * report exfiltrating another org's findings by email.
 */
describe('ComplianceReportService — Option B scoped wiring (finale)', () => {
  let service: ComplianceReportService;

  const ORG = 'org-aaaa';
  const CHECK = 'check-aaaa';
  const USER = 'user-aaaa';

  const jobRepo = { create: jest.fn(), save: jest.fn(), findOne: jest.fn(), update: jest.fn() };
  const queue = { add: jest.fn() };
  const config = { get: jest.fn() };
  const checkScoped = { scopedFindByIdOrThrow: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceReportService,
        { provide: getRepositoryToken(ComplianceReportJob), useValue: jobRepo },
        { provide: getQueueToken('compliance-jobs'), useValue: queue },
        { provide: ConfigService, useValue: config },
        { provide: ComplianceCheckScopedRepository, useValue: checkScoped },
      ],
    }).compile();
    service = module.get(ComplianceReportService);
  });

  it('routes the parent-check load through checkScoped.scopedFindByIdOrThrow with the orgId, then queues', async () => {
    checkScoped.scopedFindByIdOrThrow.mockResolvedValue({ id: CHECK });
    jobRepo.create.mockImplementation((x: any) => x);
    jobRepo.save.mockImplementation(async (x: any) => ({ id: 'job-1', ...x }));
    queue.add.mockResolvedValue({});

    const job = await service.request({
      checkId: CHECK,
      reportType: ComplianceReportType.COMPLIANCE_SUMMARY,
      userId: USER,
      orgId: ORG,
    });

    expect(checkScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(CHECK, ORG);
    // The bare check repo is gone — no bare check read here.
    expect(jobRepo.findOne).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
    expect(job).toMatchObject({ id: 'job-1', compliance_check_id: CHECK });
  });

  it('a scoped cross-org denial PROPAGATES (404) — no job row, no queue add', async () => {
    checkScoped.scopedFindByIdOrThrow.mockRejectedValue(
      new NotFoundException('Compliance check not found'),
    );

    await expect(
      service.request({
        checkId: CHECK,
        reportType: ComplianceReportType.COMPLIANCE_SUMMARY,
        userId: USER,
        orgId: ORG,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(jobRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
