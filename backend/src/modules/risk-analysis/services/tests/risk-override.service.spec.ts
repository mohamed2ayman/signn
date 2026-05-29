/**
 * Phase 7.17 — Prompt 1, B.3 unit tests for RiskOverrideService.
 *
 * Covers all 10 scenarios from the approved plan:
 *
 *   1. Successful override with no drift — risk updated, log inserted,
 *      cache invalidated, baseline-queue job enqueued, drift_warning=null
 *   2. Drift triggered when override L is 3 below resolved L (lDelta=3>2)
 *   3. Drift triggered when override I is 3 below resolved I (iDelta=3>2)
 *   4. Drift NOT triggered at boundary (lDelta=2, iDelta=2)
 *   5. Drift NOT triggered when override is ABOVE resolved (user pessimistic)
 *   6. NotFoundException when risk id doesn't exist
 *   7. NotFoundException when risk exists but belongs to a different org
 *   8. Log insert failure rolls back the risk update
 *   9. Resolver cache is invalidated AFTER the transaction commits
 *   10. Baseline-queue enqueue still allows override to succeed when it throws
 *
 * Plus the v1 source-symmetry guard added in plan Correction 1:
 *   11. Throws InternalServerErrorException when loaded risk has
 *       mismatched likelihood_source / impact_source
 *
 * Mock pattern: dataSource.transaction(cb) invokes the callback with a
 * stand-in EntityManager whose .getRepository() returns the per-entity
 * mock. The same .getRepository() is also exposed on the dataSource
 * itself for the org-ownership load query that runs OUTSIDE the
 * transaction.
 */

import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { getDataSourceToken } from '@nestjs/typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
} from '../../../../database/entities';
import { RiskSourceType } from '../../enums/risk-source-type.enum';
import { DriftReportService } from '../drift-report.service';
import {
  ResolveDefaultsResult,
  RiskMethodologyResolverService,
} from '../risk-methodology-resolver.service';
import { RiskOverrideService } from '../risk-override.service';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const RISK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTRACT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeRisk(overrides: Partial<RiskAnalysis> = {}): RiskAnalysis {
  return {
    id: RISK_ID,
    contract_id: CONTRACT_ID,
    contract_clause_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    risk_category: 'Performance Bond',
    risk_level: 'MEDIUM',
    likelihood: 3,
    impact: 3,
    risk_score: 9,
    likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
    impact_source: RiskSourceType.PLATFORM_DEFAULT,
    last_overridden_by: null,
    last_overridden_at: null,
    platform_default_ref_id: 'platform-default-uuid',
    description: 'Original AI risk',
    recommendation: 'Original rec',
    status: 'OPEN',
    ...overrides,
  } as RiskAnalysis;
}

function makeResolved(
  overrides: Partial<ResolveDefaultsResult> = {},
): ResolveDefaultsResult {
  return {
    likelihood: 4,
    impact: 4,
    likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
    impact_source: RiskSourceType.PLATFORM_DEFAULT,
    platform_default_ref_id: 'platform-default-uuid',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

// Outer load query (org-ownership join).
const mockRiskQueryBuilder = {
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};

// Inside-transaction repos.
const mockRiskRepoTxn = {
  save: jest.fn(async (entity: any) => entity),
};
const mockLogRepoTxn = {
  insert: jest.fn(async () => ({ identifiers: [{ id: 'log-uuid' }] })),
};

// Outer dataSource (used to load the risk + start the transaction).
const mockEntityManager = {
  getRepository: jest.fn((entity: any) => {
    if (entity === RiskAnalysis) return mockRiskRepoTxn;
    if (entity === RiskAnalysisOverrideLog) return mockLogRepoTxn;
    throw new Error(`Unexpected entity in transaction: ${entity?.name}`);
  }),
};

const mockDataSource = {
  getRepository: jest.fn((entity: any) => {
    if (entity === RiskAnalysis) {
      return { createQueryBuilder: jest.fn(() => mockRiskQueryBuilder) };
    }
    throw new Error(`Unexpected entity on dataSource.getRepository: ${entity?.name}`);
  }),
  transaction: jest.fn(async (cb: any) => cb(mockEntityManager)),
};

const mockResolver = {
  resolveDefaults: jest.fn<Promise<ResolveDefaultsResult>, [any]>(),
  invalidate: jest.fn(),
};

const mockBaselineQueue = {
  add: jest.fn(async () => ({ id: 'job-uuid' })),
};

// B.5 touchpoint — override service invalidates the org's drift-report
// cache after commit. One-way edge: RiskOverrideService → DriftReportService.
const mockDriftReport = {
  invalidate: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────

describe('RiskOverrideService.applyOverride', () => {
  let service: RiskOverrideService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: load returns a valid risk; resolver returns reasonable defaults.
    mockRiskQueryBuilder.getOne.mockResolvedValue(makeRisk());
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved());

    module = await Test.createTestingModule({
      providers: [
        RiskOverrideService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: RiskMethodologyResolverService, useValue: mockResolver },
        { provide: getQueueToken('learned-baseline'), useValue: mockBaselineQueue },
        { provide: DriftReportService, useValue: mockDriftReport },
      ],
    }).compile();

    service = module.get(RiskOverrideService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. Happy path — no drift
  // ──────────────────────────────────────────────────────────────────────

  it('case 1 — successful override with no drift', async () => {
    // Override (3, 3) vs resolved (4, 4) → deltas (1, 1) — no drift
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 3,
      impact: 3,
    });
    expect(result.drift_warning).toBeNull();
    expect(result.risk.likelihood).toBe(3);
    expect(result.risk.impact).toBe(3);
    expect(result.risk.likelihood_source).toBe(RiskSourceType.USER_OVERRIDE);
    expect(result.risk.impact_source).toBe(RiskSourceType.USER_OVERRIDE);
    expect(result.risk.last_overridden_by).toBe(USER_ID);
    expect(result.risk.last_overridden_at).toBeInstanceOf(Date);

    // Side effects all fired
    expect(mockRiskRepoTxn.save).toHaveBeenCalledTimes(1);
    expect(mockLogRepoTxn.insert).toHaveBeenCalledTimes(1);
    expect(mockResolver.invalidate).toHaveBeenCalledWith(ORG_ID, 'Performance Bond');
    expect(mockBaselineQueue.add).toHaveBeenCalledWith('recompute', {
      organizationId: ORG_ID,
      riskCategory: 'Performance Bond',
    });
    // B.5 touchpoint — drift-report cache invalidated after commit
    expect(mockDriftReport.invalidate).toHaveBeenCalledWith(ORG_ID);

    // Log payload captures the delta + previous source
    expect(mockLogRepoTxn.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        risk_analysis_id: RISK_ID,
        organization_id: ORG_ID,
        risk_category: 'Performance Bond',
        previous_likelihood: 3,
        previous_impact: 3,
        new_likelihood: 3,
        new_impact: 3,
        previous_source: RiskSourceType.PLATFORM_DEFAULT,
        user_id: USER_ID,
        note: null,
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2-3. Drift triggered
  // ──────────────────────────────────────────────────────────────────────

  it('case 2 — drift triggered when override L is 3 below resolved L', async () => {
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved({ likelihood: 5, impact: 4 }));
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 2,    // 5 - 2 = 3 → drift
      impact: 3,        // 4 - 3 = 1 → no drift on I
    });
    expect(result.drift_warning).not.toBeNull();
    expect(result.drift_warning?.likelihood_delta).toBe(3);
    expect(result.drift_warning?.impact_delta).toBe(1);
    expect(result.drift_warning?.resolved_likelihood).toBe(5);
    expect(result.drift_warning?.resolved_source).toBe(RiskSourceType.PLATFORM_DEFAULT);
    expect(result.drift_warning?.citation).toBe('platform_default:platform-default-uuid');
  });

  it('case 3 — drift triggered when override I is 3 below resolved I', async () => {
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved({ likelihood: 4, impact: 5 }));
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 3,    // 4 - 3 = 1 → no drift on L
      impact: 2,        // 5 - 2 = 3 → drift
    });
    expect(result.drift_warning).not.toBeNull();
    expect(result.drift_warning?.impact_delta).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. Drift NOT triggered — boundary (delta = 2)
  // ──────────────────────────────────────────────────────────────────────

  it('case 4 — drift NOT triggered at boundary (lDelta=2, iDelta=2)', async () => {
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved({ likelihood: 5, impact: 5 }));
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 3,    // 5 - 3 = 2 → boundary (>2 needed for drift)
      impact: 3,        // 5 - 3 = 2 → boundary
    });
    expect(result.drift_warning).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. Drift NOT triggered when override is ABOVE resolved
  // ──────────────────────────────────────────────────────────────────────

  it('case 5 — drift NOT triggered when override is ABOVE resolved (user more pessimistic)', async () => {
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved({ likelihood: 2, impact: 2 }));
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 5,    // 2 - 5 = -3 → negative delta → no drift
      impact: 5,
    });
    expect(result.drift_warning).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6-7. NotFound
  // ──────────────────────────────────────────────────────────────────────

  it('case 6 — throws NotFoundException when risk id does not exist', async () => {
    mockRiskQueryBuilder.getOne.mockResolvedValue(undefined);
    await expect(
      service.applyOverride({
        riskId: RISK_ID,
        userId: USER_ID,
        orgId: ORG_ID,
        likelihood: 3,
        impact: 3,
      }),
    ).rejects.toThrow(NotFoundException);
    // No side effects fired
    expect(mockRiskRepoTxn.save).not.toHaveBeenCalled();
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
    expect(mockBaselineQueue.add).not.toHaveBeenCalled();
  });

  it('case 7 — throws NotFoundException when risk belongs to a different org', async () => {
    // The org-ownership join filters at the WHERE clause level, so the
    // underlying behaviour is identical to "no row found". The query
    // builder mock returns undefined; assert the WHERE/andWhere were
    // called with the caller's orgId so the test guards the filter shape.
    mockRiskQueryBuilder.getOne.mockResolvedValue(undefined);
    await expect(
      service.applyOverride({
        riskId: RISK_ID,
        userId: USER_ID,
        orgId: ORG_ID,
        likelihood: 3,
        impact: 3,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(mockRiskQueryBuilder.andWhere).toHaveBeenCalledWith(
      'p.organization_id = :orgId',
      { orgId: ORG_ID },
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. Log insert failure rolls back
  // ──────────────────────────────────────────────────────────────────────

  it('case 8 — log insert failure rolls back the risk update (no partial commit)', async () => {
    mockLogRepoTxn.insert.mockRejectedValueOnce(new Error('log insert failed'));
    await expect(
      service.applyOverride({
        riskId: RISK_ID,
        userId: USER_ID,
        orgId: ORG_ID,
        likelihood: 3,
        impact: 3,
      }),
    ).rejects.toThrow('log insert failed');
    // Side effects that should NOT fire when the transaction rolls back:
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
    expect(mockBaselineQueue.add).not.toHaveBeenCalled();
    // The save DID get called (it's inside the same txn) but rolling
    // back at the DB level means nothing committed. Asserting that
    // requires a real DB; here we settle for proving the post-commit
    // side effects didn't fire.
  });

  // ──────────────────────────────────────────────────────────────────────
  // 9. Cache invalidation AFTER commit
  // ──────────────────────────────────────────────────────────────────────

  it('case 9 — resolver cache is invalidated AFTER the transaction commits', async () => {
    // Track the order: transaction body completes, THEN invalidate fires.
    const callOrder: string[] = [];
    mockRiskRepoTxn.save.mockImplementationOnce(async (e: any) => {
      callOrder.push('save');
      return e;
    });
    mockLogRepoTxn.insert.mockImplementationOnce(async () => {
      callOrder.push('log_insert');
      return { identifiers: [{ id: 'x' }] };
    });
    mockResolver.invalidate.mockImplementationOnce(() => {
      callOrder.push('invalidate');
    });
    await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 3,
      impact: 3,
    });
    // Invalidate must run AFTER both save and log_insert.
    expect(callOrder).toEqual(['save', 'log_insert', 'invalidate']);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 10. Baseline-queue enqueue failure doesn't fail the override
  // ──────────────────────────────────────────────────────────────────────

  it('case 10 — override still succeeds when baseline-queue enqueue throws', async () => {
    mockBaselineQueue.add.mockRejectedValueOnce(new Error('Redis down'));
    const result = await service.applyOverride({
      riskId: RISK_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      likelihood: 3,
      impact: 3,
    });
    // Override succeeded despite enqueue failure
    expect(result.risk.likelihood).toBe(3);
    // Save + log + invalidate all still fired
    expect(mockRiskRepoTxn.save).toHaveBeenCalledTimes(1);
    expect(mockLogRepoTxn.insert).toHaveBeenCalledTimes(1);
    expect(mockResolver.invalidate).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 11. v1 source-symmetry guard (plan Correction 1)
  // ──────────────────────────────────────────────────────────────────────

  it('case 11 — throws InternalServerErrorException on mismatched L/I source', async () => {
    mockRiskQueryBuilder.getOne.mockResolvedValue(
      makeRisk({
        likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
        impact_source: RiskSourceType.ORG_LEARNED,  // mismatch
      }),
    );
    await expect(
      service.applyOverride({
        riskId: RISK_ID,
        userId: USER_ID,
        orgId: ORG_ID,
        likelihood: 3,
        impact: 3,
      }),
    ).rejects.toThrow(InternalServerErrorException);
    // Guard fires BEFORE the transaction — no side effects.
    expect(mockResolver.resolveDefaults).not.toHaveBeenCalled();
    expect(mockRiskRepoTxn.save).not.toHaveBeenCalled();
    expect(mockResolver.invalidate).not.toHaveBeenCalled();
  });
});
