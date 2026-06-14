/**
 * Phase 7.18 — finalize_review metered consumer: CONSUMER-LEVEL wiring spec.
 *
 * Proves the finalizeReview wiring with mocked deps (the engine itself is
 * covered against real Postgres by metering-finalize-review.spec.ts):
 *
 *   - reserve sits DOWNSTREAM of the contract-access wall (cross-tenant 404
 *     fires BEFORE reserve → no charge).
 *   - reserve uses meter_key=finalize_review, amount 1, the URL contractId,
 *     and the MANAGING caller threaded from the controller.
 *   - the risk poller OWNS the reservation: commit on risk completion,
 *     release on risk failure AND on poll timeout.
 *   - synchronous dispatch failure (risk dispatch throws before the poller
 *     launches) releases in-request, then re-throws.
 *   - a poller invoked WITHOUT a reservation_id (legacy/direct callers)
 *     touches neither commit nor release.
 *
 * Uses jest fake timers to skip the 60×3s poll loop (mirrors
 * ai-risk-writer-integration.spec.ts).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import {
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  DocumentUpload,
  RiskAnalysis,
  RiskCategory,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { StorageService } from '../../storage/storage.service';
import { DocumentProcessingService } from '../document-processing.service';
import { RiskMethodologyResolverService } from '../../risk-analysis/services/risk-methodology-resolver.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { MeteringService } from '../../metering/services/metering.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';
import { DocumentUploadScopedRepository } from '../../scoped-repository/document-upload-scoped.repository';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONTRACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRACT_IN_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CLAUSE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const JOB_ID = 'job-uuid-finalize';
const RES_ID = '99999999-9999-4999-8999-999999999999';

const stubRepo = {} as any;

function completedJob(risks: any[]) {
  return { status: 'completed', result: { risks } };
}
function failedJob(error = 'Anthropic 503') {
  return { status: 'failed', error };
}
function pendingJob() {
  return { status: 'pending' };
}

describe('finalize_review metered consumer (wiring)', () => {
  let service: DocumentProcessingService;
  let module: TestingModule;

  // Re-created per test so call counts/order are clean.
  let mockAiService: any;
  let mockContractAccess: any;
  let mockMetering: any;
  let mockContractClauseRepo: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValue([
          { clause: { id: CLAUSE_ID, content: 'clause text', source_document: null } },
        ]),
    };
    mockContractClauseRepo = { createQueryBuilder: jest.fn(() => qb) };

    mockAiService = {
      getJobStatus: jest.fn(),
      triggerRiskAnalysis: jest
        .fn()
        .mockResolvedValue({ job_id: JOB_ID, status: 'pending' }),
      triggerExtractObligations: jest
        .fn()
        .mockResolvedValue({ job_id: 'obl-job', status: 'pending' }),
      triggerConflictDetection: jest
        .fn()
        .mockResolvedValue({ job_id: 'conf-job', status: 'pending' }),
    };

    mockContractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

    mockMetering = {
      reserve: jest.fn().mockResolvedValue({
        reservation_id: RES_ID,
        ledger_id: 'led-1',
        subject_ref: ORG_ID,
        meter_key: MeterKey.FINALIZE_REVIEW,
        window_key: CONTRACT_ID,
        amount: 1,
        expires_at: new Date(),
        reused: false,
      }),
      commit: jest.fn().mockResolvedValue({ applied: true, status: 'committed' }),
      release: jest.fn().mockResolvedValue({ applied: true, status: 'released' }),
    };

    module = await Test.createTestingModule({
      providers: [
        DocumentProcessingService,
        { provide: getRepositoryToken(DocumentUpload), useValue: stubRepo },
        { provide: getRepositoryToken(Clause), useValue: stubRepo },
        { provide: getRepositoryToken(ContractClause), useValue: mockContractClauseRepo },
        { provide: getRepositoryToken(Contract), useValue: stubRepo },
        { provide: getRepositoryToken(RiskAnalysis), useValue: stubRepo },
        { provide: getRepositoryToken(AuditLog), useValue: stubRepo },
        { provide: getRepositoryToken(RiskCategory), useValue: stubRepo },
        { provide: StorageService, useValue: {} },
        { provide: AiService, useValue: mockAiService },
        { provide: RiskMethodologyResolverService, useValue: {} },
        { provide: ContractAccessService, useValue: mockContractAccess },
        { provide: MeteringService, useValue: mockMetering },
        // Option B — S2f: DocumentUploadScopedRepository is now a REQUIRED dep.
        // finalizeReview / pollAndSaveRisks do NOT load via the scoped
        // chokepoint, so this stub is never invoked — it only satisfies DI.
        {
          provide: DocumentUploadScopedRepository,
          useValue: { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DocumentProcessingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Drive the private pollAndSaveRisks past its 60×3s loop instantly.
  async function drivePoll(reservationId?: string | null) {
    const promise = (service as any).pollAndSaveRisks(
      CONTRACT_ID,
      JOB_ID,
      ORG_ID,
      reservationId,
    );
    for (let i = 0; i < 65; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }
    return promise;
  }

  // ── Poller terminal: COMMIT on risk completion ──────────────────────────
  it('commits the reservation when the risk job completes', async () => {
    mockAiService.getJobStatus.mockResolvedValue(completedJob([]));

    await drivePoll(RES_ID);

    expect(mockMetering.commit).toHaveBeenCalledTimes(1);
    expect(mockMetering.commit).toHaveBeenCalledWith(RES_ID);
    expect(mockMetering.release).not.toHaveBeenCalled();
  });

  // ── Poller terminal: RELEASE on risk failure ────────────────────────────
  it('releases the reservation when the risk job fails', async () => {
    mockAiService.getJobStatus.mockResolvedValue(failedJob());

    await drivePoll(RES_ID);

    expect(mockMetering.release).toHaveBeenCalledTimes(1);
    expect(mockMetering.release).toHaveBeenCalledWith(RES_ID);
    expect(mockMetering.commit).not.toHaveBeenCalled();
  });

  // ── Poller terminal: RELEASE on poll timeout ────────────────────────────
  it('releases the reservation when the risk job poll times out', async () => {
    mockAiService.getJobStatus.mockResolvedValue(pendingJob());

    await drivePoll(RES_ID);

    expect(mockAiService.getJobStatus.mock.calls.length).toBe(60); // hit MAX_POLLS
    expect(mockMetering.release).toHaveBeenCalledTimes(1);
    expect(mockMetering.release).toHaveBeenCalledWith(RES_ID);
    expect(mockMetering.commit).not.toHaveBeenCalled();
  });

  // ── Backward-compat: no reservationId → no metering calls ────────────────
  it('touches neither commit nor release when invoked without a reservation_id', async () => {
    mockAiService.getJobStatus.mockResolvedValue(completedJob([]));

    await drivePoll(undefined);

    expect(mockMetering.commit).not.toHaveBeenCalled();
    expect(mockMetering.release).not.toHaveBeenCalled();
  });

  // ── finalizeReview: reserve AFTER the wall, with finalize_review key ─────
  it('finalizeReview reserves finalize_review (amount 1, URL contractId) AFTER the access wall', async () => {
    // Stop the detached poller from doing anything (covered separately above).
    jest
      .spyOn(service as any, 'pollAndSaveRisks')
      .mockResolvedValue(undefined);

    await service.finalizeReview(CONTRACT_ID, ORG_ID, { user_id: USER_ID });

    // Wall fired before reserve.
    expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_ID, ORG_ID);
    expect(mockMetering.reserve).toHaveBeenCalledTimes(1);
    const reserveArg = mockMetering.reserve.mock.calls[0][0];
    expect(reserveArg).toMatchObject({
      meterKey: MeterKey.FINALIZE_REVIEW,
      amount: 1,
      contractId: CONTRACT_ID,
      actorRef: USER_ID,
      caller: {
        user_id: USER_ID,
        jwt_organization_id: ORG_ID,
        account_type: 'MANAGING',
      },
    });
    // Order: wall strictly before reserve.
    expect(
      mockContractAccess.findInOrg.mock.invocationCallOrder[0],
    ).toBeLessThan(mockMetering.reserve.mock.invocationCallOrder[0]);
  });

  // ── finalizeReview: cross-tenant → wall 404s BEFORE reserve (no charge) ──
  it('does NOT reserve when the access wall rejects (cross-tenant probe)', async () => {
    mockContractAccess.findInOrg.mockRejectedValueOnce(
      new NotFoundException('Contract not found'),
    );

    await expect(
      service.finalizeReview(CONTRACT_IN_B, ORG_B, { user_id: USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockMetering.reserve).not.toHaveBeenCalled();
    expect(mockMetering.commit).not.toHaveBeenCalled();
    expect(mockMetering.release).not.toHaveBeenCalled();
  });

  // ── finalizeReview: synchronous dispatch failure releases in-flight ──────
  it('releases the reservation in-request when the risk dispatch throws synchronously', async () => {
    jest
      .spyOn(service as any, 'pollAndSaveRisks')
      .mockResolvedValue(undefined);
    mockAiService.triggerRiskAnalysis.mockRejectedValueOnce(
      new Error('AI backend down'),
    );

    await expect(
      service.finalizeReview(CONTRACT_ID, ORG_ID, { user_id: USER_ID }),
    ).rejects.toThrow('AI backend down');

    // Reserved, then released in-flight; never committed.
    expect(mockMetering.reserve).toHaveBeenCalledTimes(1);
    expect(mockMetering.release).toHaveBeenCalledWith(RES_ID);
    expect(mockMetering.commit).not.toHaveBeenCalled();
  });
});
