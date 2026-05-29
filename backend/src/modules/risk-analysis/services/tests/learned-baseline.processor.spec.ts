/**
 * Phase 7.17 — Prompt 1, B.4.4 integration tests for
 * LearnedBaselineProcessor.
 *
 * Drives handleRecompute({ organizationId, riskCategory }) with mocked
 * override-log repo, mocked baseline repo, and mocked resolver. No real
 * Bull, no real Redis, no real DB. Job is a minimal stub matching the
 * Job<RecomputeBaselineJobData> shape the handler reads.
 *
 * Covers the 10 scenarios from the approved B.4 plan. Test #6 uses
 * count=100 / sample=50 (the only configuration that distinguishes the
 * "total lifetime count" semantic from the "sample size" semantic for
 * the override_count column).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';

import {
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
} from '../../../../database/entities';
import { LearnedBaselineProcessor } from '../../learned-baseline.processor';
import { RiskMethodologyResolverService } from '../risk-methodology-resolver.service';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CATEGORY = 'Performance Bond';

function makeJob(): Job<{ organizationId: string; riskCategory: string }> {
  return {
    id: 'job-1',
    data: { organizationId: ORG_ID, riskCategory: CATEGORY },
  } as Job<{ organizationId: string; riskCategory: string }>;
}

/** Build N override-log sample rows with the given L,I value arrays. */
function sampleRows(
  likelihoods: number[],
  impacts: number[],
): Array<{ new_likelihood: number; new_impact: number }> {
  return likelihoods.map((l, idx) => ({
    new_likelihood: l,
    new_impact: impacts[idx],
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

const mockOverrideLogRepo = {
  count: jest.fn(),
  find: jest.fn(),
};

// Explicit 2-arg signature so `.mock.calls[0][0]` (payload) and
// `[0][1]` (conflict options) are typed — TypeORM's upsert(entity,
// conflictPathsOrOptions) takes two args.
const mockBaselineRepo = {
  upsert: jest.fn<Promise<any>, [any, any]>(async () => ({
    identifiers: [{ id: 'baseline-uuid' }],
  })),
};

const mockResolver = {
  invalidate: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────

describe('LearnedBaselineProcessor.handleRecompute', () => {
  let processor: LearnedBaselineProcessor;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        LearnedBaselineProcessor,
        {
          provide: getRepositoryToken(RiskAnalysisOverrideLog),
          useValue: mockOverrideLogRepo,
        },
        {
          provide: getRepositoryToken(RiskCategoryOrgLearnedBaseline),
          useValue: mockBaselineRepo,
        },
        { provide: RiskMethodologyResolverService, useValue: mockResolver },
      ],
    }).compile();

    processor = module.get(LearnedBaselineProcessor);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Threshold gate
  // ──────────────────────────────────────────────────────────────────────

  it('case 1 — exits cleanly when override count is below threshold (< 10)', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(9);

    await processor.handleRecompute(makeJob());

    expect(mockOverrideLogRepo.find).not.toHaveBeenCalled();
    expect(mockBaselineRepo.upsert).not.toHaveBeenCalled();
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
  });

  it('case 2 — proceeds when count is exactly at threshold (10)', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(10);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows([1, 2, 2, 3, 3, 4, 4, 5, 5, 5], [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
    );

    await processor.handleRecompute(makeJob());

    expect(mockBaselineRepo.upsert).toHaveBeenCalledTimes(1);
  });

  it('case 3 — proceeds when count is above threshold (23)', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(23);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows([3, 3, 3], [4, 4, 4]),
    );

    await processor.handleRecompute(makeJob());

    expect(mockBaselineRepo.upsert).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Sample size cap
  // ──────────────────────────────────────────────────────────────────────

  it('case 4 — caps sample at 50 most-recent rows (take: 50, order DESC)', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(100);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(Array(50).fill(3), Array(50).fill(3)),
    );

    await processor.handleRecompute(makeJob());

    expect(mockOverrideLogRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: ORG_ID, risk_category: CATEGORY },
        order: { created_at: 'DESC' },
        take: 50,
        select: ['new_likelihood', 'new_impact'],
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Computation correctness
  // ──────────────────────────────────────────────────────────────────────

  it('case 5 — upserts with the median L and median I from the sample', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(10);
    // L sorted: [1,2,2,3,3,4,4,5,5,5] → lower midpoint (index 4) = 3
    // I sorted: [1,1,2,2,2,3,3,4,4,5] → lower midpoint (index 4) = 2
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(
        [1, 2, 2, 3, 3, 4, 4, 5, 5, 5],
        [3, 1, 2, 4, 2, 1, 3, 2, 4, 5],
      ),
    );

    await processor.handleRecompute(makeJob());

    const payload = mockBaselineRepo.upsert.mock.calls[0][0];
    expect(payload.learned_likelihood).toBe(3);
    expect(payload.learned_impact).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Upsert semantics — TOTAL lifetime count, not sample size
  // (count > 50 is the ONLY config that distinguishes the two)
  // ──────────────────────────────────────────────────────────────────────

  it('case 6 — override_count is the TOTAL lifetime count, not the sample size', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(100); // total lifetime
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(Array(50).fill(4), Array(50).fill(4)), // sample capped at 50
    );

    await processor.handleRecompute(makeJob());

    const payload = mockBaselineRepo.upsert.mock.calls[0][0];
    // Must be 100 (total), NOT 50 (sample). This is the assertion that
    // proves the lifetime-count semantic.
    expect(payload.override_count).toBe(100);
  });

  it('case 7 — upsert uses (organization_id, risk_category) as the conflict path', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(10);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(Array(10).fill(3), Array(10).fill(3)),
    );

    await processor.handleRecompute(makeJob());

    const conflictOpts = mockBaselineRepo.upsert.mock.calls[0][1];
    expect(conflictOpts).toEqual(
      expect.objectContaining({
        conflictPaths: ['organization_id', 'risk_category'],
      }),
    );
    // Payload identity fields present
    const payload = mockBaselineRepo.upsert.mock.calls[0][0];
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.risk_category).toBe(CATEGORY);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cache invalidation AFTER upsert
  // ──────────────────────────────────────────────────────────────────────

  it('case 8 — invalidates resolver cache AFTER the upsert', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(10);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(Array(10).fill(3), Array(10).fill(3)),
    );

    const callOrder: string[] = [];
    mockBaselineRepo.upsert.mockImplementationOnce(async () => {
      callOrder.push('upsert');
      return { identifiers: [{ id: 'x' }] };
    });
    mockResolver.invalidate.mockImplementationOnce(() => {
      callOrder.push('invalidate');
    });

    await processor.handleRecompute(makeJob());

    expect(callOrder).toEqual(['upsert', 'invalidate']);
    expect(mockResolver.invalidate).toHaveBeenCalledWith(ORG_ID, CATEGORY);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Defensive — count >= 10 but find returns empty (race)
  // ──────────────────────────────────────────────────────────────────────

  it('case 9 — skips with warn when count >= 10 but sample is empty', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(15);
    mockOverrideLogRepo.find.mockResolvedValue([]); // race: rows vanished

    await processor.handleRecompute(makeJob());

    expect(mockBaselineRepo.upsert).not.toHaveBeenCalled();
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Failure mode — upsert throws → handler propagates (Bull marks failed)
  // ──────────────────────────────────────────────────────────────────────

  it('case 10 — propagates upsert failure so Bull marks the job failed', async () => {
    mockOverrideLogRepo.count.mockResolvedValue(10);
    mockOverrideLogRepo.find.mockResolvedValue(
      sampleRows(Array(10).fill(3), Array(10).fill(3)),
    );
    mockBaselineRepo.upsert.mockRejectedValueOnce(new Error('DB down'));

    await expect(processor.handleRecompute(makeJob())).rejects.toThrow('DB down');
    // Cache invalidation must NOT fire when the upsert failed.
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
  });
});
