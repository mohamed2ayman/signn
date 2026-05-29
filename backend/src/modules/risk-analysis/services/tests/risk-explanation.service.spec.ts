/**
 * Phase 7.17 — Prompt 1, B.5 unit tests for RiskExplanationService.
 *
 * 8 cases from the approved plan:
 *   1. returns current + resolution + override_history for a valid finding
 *   2. 404 when finding not in caller's org
 *   3. resolution.citation populated when resolver source = PLATFORM_DEFAULT
 *   4. resolution.learned_baseline_count populated when source = ORG_LEARNED
 *   5. resolution differs from current when finding was overridden
 *   6. override_history ordered newest-first (orderBy DESC asserted)
 *   7. deleted-user override row → overridden_by.display_name = null
 *   8. finding with zero overrides → override_history = []
 *
 * Mock pattern: each repo's createQueryBuilder returns a chainable stub
 * whose terminal method (getOne / getMany) yields the configured value.
 * The two query builders (risk load + override-log history) are distinct
 * stubs since they belong to different repos.
 */

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
  User,
} from '../../../../database/entities';
import { RiskSourceType } from '../../enums/risk-source-type.enum';
import {
  ResolveDefaultsResult,
  RiskMethodologyResolverService,
} from '../risk-methodology-resolver.service';
import { RiskExplanationService } from '../risk-explanation.service';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const RISK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeRisk(overrides: Partial<RiskAnalysis> = {}): RiskAnalysis {
  return {
    id: RISK_ID,
    risk_category: 'Performance Bond',
    likelihood: 3,
    impact: 3,
    risk_score: 9,
    likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
    impact_source: RiskSourceType.PLATFORM_DEFAULT,
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
    platform_default_ref_id: PD_ID,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@sign.com',
    ...overrides,
  } as User;
}

function makeLogRow(
  overrides: Partial<RiskAnalysisOverrideLog> = {},
): RiskAnalysisOverrideLog {
  return {
    id: 'log-1',
    risk_analysis_id: RISK_ID,
    organization_id: ORG_ID,
    risk_category: 'Performance Bond',
    previous_likelihood: 4,
    previous_impact: 4,
    new_likelihood: 3,
    new_impact: 3,
    previous_source: RiskSourceType.PLATFORM_DEFAULT,
    user_id: USER_ID,
    user: makeUser(),
    note: 'too pessimistic for our market',
    created_at: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  } as RiskAnalysisOverrideLog;
}

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

const mockRiskQb = {
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};

const mockLogQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockRiskRepo = {
  createQueryBuilder: jest.fn(() => mockRiskQb),
};
const mockLogRepo = {
  createQueryBuilder: jest.fn(() => mockLogQb),
};
const mockPdRepo = { findOne: jest.fn() };
const mockBaselineRepo = { findOne: jest.fn() };
const mockResolver = { resolveDefaults: jest.fn() };

// ─────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────

describe('RiskExplanationService.getExplanation', () => {
  let service: RiskExplanationService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Defaults: valid finding, PLATFORM_DEFAULT resolution, one override.
    mockRiskQb.getOne.mockResolvedValue(makeRisk());
    mockResolver.resolveDefaults.mockResolvedValue(makeResolved());
    mockLogQb.getMany.mockResolvedValue([makeLogRow()]);
    mockPdRepo.findOne.mockResolvedValue({
      id: PD_ID,
      apa_citation_short: '(Purba et al., 2020)',
      apa_citation_full: 'Purba, A. et al. (2020). Risk in construction...',
    });
    mockBaselineRepo.findOne.mockResolvedValue(null);

    module = await Test.createTestingModule({
      providers: [
        RiskExplanationService,
        { provide: getRepositoryToken(RiskAnalysis), useValue: mockRiskRepo },
        {
          provide: RiskMethodologyResolverService,
          useValue: mockResolver,
        },
        {
          provide: getRepositoryToken(RiskCategoryPlatformDefault),
          useValue: mockPdRepo,
        },
        {
          provide: getRepositoryToken(RiskCategoryOrgLearnedBaseline),
          useValue: mockBaselineRepo,
        },
        {
          provide: getRepositoryToken(RiskAnalysisOverrideLog),
          useValue: mockLogRepo,
        },
      ],
    }).compile();

    service = module.get(RiskExplanationService);
  });

  // 1 ──────────────────────────────────────────────────────────────────────
  it('case 1 — returns current + resolution + override_history', async () => {
    const result = await service.getExplanation(RISK_ID, ORG_ID);

    expect(result.current).toEqual({
      likelihood: 3,
      impact: 3,
      risk_score: 9,
      likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
      impact_source: RiskSourceType.PLATFORM_DEFAULT,
    });
    expect(result.resolution.likelihood).toBe(4);
    expect(result.resolution.impact).toBe(4);
    expect(result.resolution.source).toBe(RiskSourceType.PLATFORM_DEFAULT);
    expect(result.override_history).toHaveLength(1);
    expect(result.override_history[0]).toMatchObject({
      previous_likelihood: 4,
      new_likelihood: 3,
      previous_source: RiskSourceType.PLATFORM_DEFAULT,
      note: 'too pessimistic for our market',
    });
    expect(result.override_history[0].overridden_by).toEqual({
      id: USER_ID,
      display_name: 'Jane Doe',
    });
    // org-scoped load applied
    expect(mockRiskQb.andWhere).toHaveBeenCalledWith(
      'p.organization_id = :orgId',
      { orgId: ORG_ID },
    );
  });

  // 2 ──────────────────────────────────────────────────────────────────────
  it('case 2 — 404 when finding not in caller org', async () => {
    mockRiskQb.getOne.mockResolvedValue(null);
    await expect(service.getExplanation(RISK_ID, ORG_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // 3 ──────────────────────────────────────────────────────────────────────
  it('case 3 — citation populated when resolution source = PLATFORM_DEFAULT', async () => {
    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.resolution.citation).toEqual({
      short: '(Purba et al., 2020)',
      full: 'Purba, A. et al. (2020). Risk in construction...',
    });
    expect(result.resolution.learned_baseline_count).toBeUndefined();
    expect(mockPdRepo.findOne).toHaveBeenCalledWith({ where: { id: PD_ID } });
  });

  // 4 ──────────────────────────────────────────────────────────────────────
  it('case 4 — learned_baseline_count populated when source = ORG_LEARNED', async () => {
    mockResolver.resolveDefaults.mockResolvedValue(
      makeResolved({
        likelihood_source: RiskSourceType.ORG_LEARNED,
        impact_source: RiskSourceType.ORG_LEARNED,
        platform_default_ref_id: undefined,
      }),
    );
    mockBaselineRepo.findOne.mockResolvedValue({
      organization_id: ORG_ID,
      risk_category: 'Performance Bond',
      learned_likelihood: 4,
      learned_impact: 4,
      override_count: 17,
    });

    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.resolution.learned_baseline_count).toBe(17);
    expect(result.resolution.citation).toBeUndefined();
    expect(mockPdRepo.findOne).not.toHaveBeenCalled();
  });

  // 5 ──────────────────────────────────────────────────────────────────────
  it('case 5 — resolution differs from current when finding was overridden', async () => {
    // Finding has been overridden to (2,2); resolver still says (4,4).
    mockRiskQb.getOne.mockResolvedValue(
      makeRisk({
        likelihood: 2,
        impact: 2,
        risk_score: 4,
        likelihood_source: RiskSourceType.USER_OVERRIDE,
        impact_source: RiskSourceType.USER_OVERRIDE,
      }),
    );

    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.current.likelihood).toBe(2);
    expect(result.current.likelihood_source).toBe(RiskSourceType.USER_OVERRIDE);
    expect(result.resolution.likelihood).toBe(4);
    expect(result.resolution.source).toBe(RiskSourceType.PLATFORM_DEFAULT);
    expect(result.current.likelihood).not.toBe(result.resolution.likelihood);
  });

  // 6 ──────────────────────────────────────────────────────────────────────
  it('case 6 — override_history ordered newest-first', async () => {
    const newer = makeLogRow({
      id: 'log-newer',
      created_at: new Date('2026-05-22T10:00:00.000Z'),
      note: 'newer',
    });
    const older = makeLogRow({
      id: 'log-older',
      created_at: new Date('2026-05-18T10:00:00.000Z'),
      note: 'older',
    });
    // Repo returns DESC-ordered rows (newest first); service preserves order.
    mockLogQb.getMany.mockResolvedValue([newer, older]);

    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.override_history.map((o) => o.note)).toEqual([
      'newer',
      'older',
    ]);
    expect(mockLogQb.orderBy).toHaveBeenCalledWith('o.created_at', 'DESC');
  });

  // 7 ──────────────────────────────────────────────────────────────────────
  it('case 7 — deleted-user override row → display_name null', async () => {
    mockLogQb.getMany.mockResolvedValue([
      makeLogRow({ user: null, user_id: null }),
    ]);

    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.override_history[0].overridden_by).toEqual({
      id: '',
      display_name: null,
    });
  });

  // 8 ──────────────────────────────────────────────────────────────────────
  it('case 8 — finding with zero overrides → empty history', async () => {
    mockLogQb.getMany.mockResolvedValue([]);
    const result = await service.getExplanation(RISK_ID, ORG_ID);
    expect(result.override_history).toEqual([]);
  });
});
