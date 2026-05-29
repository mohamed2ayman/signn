/**
 * Phase 7.17 — Prompt 1, B.5 unit tests for DriftReportService.
 *
 * 12 cases:
 *   1. org_summary counts (lifetime + 30d)
 *   2. most_overridden_categories capped at top 10 (asserts .limit(10))
 *   3. avg deltas rounded to 1 decimal (round1)
 *   4. drift_alert mapped + enriched (platform_default + learned_baseline), L-driven
 *   5. drift_alert mapped, I-driven (impact delta)
 *   6. drift query uses count floor = 5 (Flag 11)
 *   7. drift query uses delta threshold = 1.5 (Flag 11)
 *   8. empty filtered drift query → drift_alerts = []
 *   9. platform_default = null in alert when no seed exists
 *   10. lifted cap — drift_alerts is sourced from its own query, NOT the
 *       top-10-by-count catRows
 *   11. cache: 2nd call within TTL skips re-query; invalidate() forces re-query
 *   12. fallback_categories mapping + FALLBACK filter + >5 floor
 *
 * Mock pattern: the override-log repo's createQueryBuilder returns a fresh
 * self-identifying stub per call. A stub returns `alertRows` from
 * getRawMany if `.having()` was invoked on it (the drift-alerts query),
 * else `catRows` (the most-overridden query). The trailing-30-day query
 * uses getCount. This makes the mock independent of call ORDER, so it
 * survives the multiple getDriftReport() invocations in the cache test.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
} from '../../../../database/entities';
import { RiskSourceType } from '../../enums/risk-source-type.enum';
import { DriftReportService } from '../drift-report.service';

const ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ─── Per-test state (assigned in beforeEach, overridden inside tests) ──────
let catRows: any[];
let alertRows: any[];
let fallbackRows: any[];
let thirtyDayCount: number;
let lifetimeCount: number;
let createdLogQbs: any[];

const mockOverrideLogRepo: any = {
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
};

function freshLogQb(): any {
  const qb: any = {
    _having: false,
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    having: jest.fn(function (this: any) {
      this._having = true;
      return this;
    }),
    andHaving: jest.fn().mockReturnThis(),
    getCount: jest.fn(async () => thirtyDayCount),
    getRawMany: jest.fn(async function (this: any) {
      return this._having ? alertRows : catRows;
    }),
  };
  createdLogQbs.push(qb);
  return qb;
}

// Platform-default repo QB (one per alert row).
const mockPdQb: any = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};
const mockPlatformDefaultRepo: any = {
  createQueryBuilder: jest.fn(() => mockPdQb),
};

const mockBaselineRepo: any = { findOne: jest.fn() };

// Risk repo QB (fallback_categories).
const mockRiskQb: any = {
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  having: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(async () => fallbackRows),
};
const mockRiskRepo: any = {
  createQueryBuilder: jest.fn(() => mockRiskQb),
};

function alertStub(): any {
  return createdLogQbs.find((q) => q.having.mock.calls.length > 0);
}
function catStub(): any {
  return createdLogQbs.find((q) => q.limit.mock.calls.length > 0);
}

describe('DriftReportService.getDriftReport', () => {
  let service: DriftReportService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    createdLogQbs = [];
    lifetimeCount = 12;
    thirtyDayCount = 5;
    catRows = [
      {
        risk_category: 'Performance Bond',
        override_count: '20',
        avg_l_delta: '1.0',
        avg_i_delta: '0.5',
      },
    ];
    alertRows = [
      {
        risk_category: 'Performance Bond',
        override_count: '6',
        avg_l_delta: '2.0',
        avg_i_delta: '0.2',
      },
    ];
    fallbackRows = [];

    mockOverrideLogRepo.count.mockResolvedValue(lifetimeCount);
    mockOverrideLogRepo.createQueryBuilder.mockImplementation(() =>
      freshLogQb(),
    );
    mockPdQb.getOne.mockResolvedValue({
      default_likelihood: 5,
      default_impact: 5,
    });
    mockBaselineRepo.findOne.mockResolvedValue(null);

    module = await Test.createTestingModule({
      providers: [
        DriftReportService,
        {
          provide: getRepositoryToken(RiskAnalysisOverrideLog),
          useValue: mockOverrideLogRepo,
        },
        {
          provide: getRepositoryToken(RiskCategoryPlatformDefault),
          useValue: mockPlatformDefaultRepo,
        },
        {
          provide: getRepositoryToken(RiskCategoryOrgLearnedBaseline),
          useValue: mockBaselineRepo,
        },
        { provide: getRepositoryToken(RiskAnalysis), useValue: mockRiskRepo },
      ],
    }).compile();

    service = module.get(DriftReportService);
  });

  // 1 ──────────────────────────────────────────────────────────────────────
  it('case 1 — org_summary lifetime + 30d counts', async () => {
    const r = await service.getDriftReport(ORG_ID);
    expect(r.org_summary.total_overrides_lifetime).toBe(12);
    expect(r.org_summary.total_overrides_30d).toBe(5);
    expect(mockOverrideLogRepo.count).toHaveBeenCalledWith({
      where: { organization_id: ORG_ID },
    });
  });

  // 2 ──────────────────────────────────────────────────────────────────────
  it('case 2 — most_overridden_categories capped at top 10', async () => {
    const r = await service.getDriftReport(ORG_ID);
    expect(r.org_summary.most_overridden_categories[0]).toEqual({
      risk_category: 'Performance Bond',
      override_count: 20,
      avg_likelihood_delta: 1,
      avg_impact_delta: 0.5,
    });
    expect(catStub().limit).toHaveBeenCalledWith(10);
  });

  // 3 ──────────────────────────────────────────────────────────────────────
  it('case 3 — avg deltas rounded to one decimal', async () => {
    catRows = [
      {
        risk_category: 'Delay',
        override_count: '7',
        avg_l_delta: '1.6666666',
        avg_i_delta: '1.04',
      },
    ];
    const r = await service.getDriftReport(ORG_ID);
    expect(r.org_summary.most_overridden_categories[0].avg_likelihood_delta).toBe(
      1.7,
    );
    expect(r.org_summary.most_overridden_categories[0].avg_impact_delta).toBe(1);
  });

  // 4 ──────────────────────────────────────────────────────────────────────
  it('case 4 — drift_alert mapped + enriched (L-driven)', async () => {
    mockBaselineRepo.findOne.mockResolvedValue({
      learned_likelihood: 3,
      learned_impact: 3,
      override_count: 11,
    });
    const r = await service.getDriftReport(ORG_ID);
    expect(r.drift_alerts).toHaveLength(1);
    expect(r.drift_alerts[0]).toEqual({
      risk_category: 'Performance Bond',
      override_count: 6,
      avg_likelihood_delta: 2,
      avg_impact_delta: 0.2,
      platform_default: {
        likelihood: 5,
        impact: 5,
        source: RiskSourceType.PLATFORM_DEFAULT,
      },
      learned_baseline: { likelihood: 3, impact: 3, override_count: 11 },
    });
  });

  // 5 ──────────────────────────────────────────────────────────────────────
  it('case 5 — drift_alert I-driven (impact delta high)', async () => {
    alertRows = [
      {
        risk_category: 'Insurance',
        override_count: '8',
        avg_l_delta: '0.1',
        avg_i_delta: '1.8',
      },
    ];
    const r = await service.getDriftReport(ORG_ID);
    expect(r.drift_alerts).toHaveLength(1);
    expect(r.drift_alerts[0].risk_category).toBe('Insurance');
    expect(r.drift_alerts[0].avg_impact_delta).toBe(1.8);
    expect(r.drift_alerts[0].avg_likelihood_delta).toBe(0.1);
  });

  // 6 ──────────────────────────────────────────────────────────────────────
  it('case 6 — drift query uses count floor = 5 (Flag 11)', async () => {
    await service.getDriftReport(ORG_ID);
    expect(alertStub().having).toHaveBeenCalledWith(
      'COUNT(*) >= :minOverrides',
      { minOverrides: 5 },
    );
  });

  // 7 ──────────────────────────────────────────────────────────────────────
  it('case 7 — drift query uses delta threshold = 1.5 (Flag 11)', async () => {
    await service.getDriftReport(ORG_ID);
    expect(alertStub().andHaving).toHaveBeenCalledWith(
      '(AVG(o.previous_likelihood - o.new_likelihood) > :delta OR AVG(o.previous_impact - o.new_impact) > :delta)',
      { delta: 1.5 },
    );
  });

  // 8 ──────────────────────────────────────────────────────────────────────
  it('case 8 — empty filtered drift query → no alerts', async () => {
    alertRows = [];
    const r = await service.getDriftReport(ORG_ID);
    expect(r.drift_alerts).toEqual([]);
  });

  // 9 ──────────────────────────────────────────────────────────────────────
  it('case 9 — platform_default null when no seed exists', async () => {
    mockPdQb.getOne.mockResolvedValue(null);
    mockBaselineRepo.findOne.mockResolvedValue(null);
    const r = await service.getDriftReport(ORG_ID);
    expect(r.drift_alerts[0].platform_default).toBeNull();
    expect(r.drift_alerts[0].learned_baseline).toBeUndefined();
    // The platform-default lookup is jurisdiction-agnostic in v1.
    expect(mockPdQb.andWhere).toHaveBeenCalledWith(
      'pd.jurisdiction_variant IS NULL',
    );
  });

  // 10 ─────────────────────────────────────────────────────────────────────
  it('case 10 — lifted cap: drift_alerts sourced from own query, not top-10', async () => {
    // High-volume, non-drifting category dominates the top-10 list.
    catRows = [
      {
        risk_category: 'High Volume',
        override_count: '20',
        avg_l_delta: '0',
        avg_i_delta: '0',
      },
    ];
    // A lower-volume, strongly-drifting category is what the HAVING query
    // returns — it would never make the top-10-by-count cut.
    alertRows = [
      {
        risk_category: 'Low Volume Drifting',
        override_count: '6',
        avg_l_delta: '2.0',
        avg_i_delta: '0',
      },
    ];
    const r = await service.getDriftReport(ORG_ID);
    expect(r.drift_alerts.map((a) => a.risk_category)).toEqual([
      'Low Volume Drifting',
    ]);
    expect(
      r.org_summary.most_overridden_categories.map((c) => c.risk_category),
    ).toContain('High Volume');
    expect(r.drift_alerts.map((a) => a.risk_category)).not.toContain(
      'High Volume',
    );
  });

  // 11 ─────────────────────────────────────────────────────────────────────
  it('case 11 — cache hit within TTL; invalidate forces re-query', async () => {
    await service.getDriftReport(ORG_ID);
    const after1 = mockOverrideLogRepo.count.mock.calls.length;
    expect(after1).toBe(1);

    await service.getDriftReport(ORG_ID); // cached — no new query
    expect(mockOverrideLogRepo.count.mock.calls.length).toBe(after1);

    service.invalidate(ORG_ID);
    await service.getDriftReport(ORG_ID); // re-query
    expect(mockOverrideLogRepo.count.mock.calls.length).toBe(after1 + 1);
  });

  // 12 ─────────────────────────────────────────────────────────────────────
  it('case 12 — fallback_categories mapping + FALLBACK filter + >5 floor', async () => {
    fallbackRows = [
      { risk_category: 'Subcontractor Default', finding_count: '7' },
    ];
    const r = await service.getDriftReport(ORG_ID);
    expect(r.fallback_categories).toEqual([
      { risk_category: 'Subcontractor Default', finding_count: 7 },
    ]);
    expect(mockRiskQb.andWhere).toHaveBeenCalledWith(
      'r.likelihood_source = :src',
      { src: RiskSourceType.FALLBACK },
    );
    expect(mockRiskQb.having).toHaveBeenCalledWith('COUNT(*) > :minFindings', {
      minFindings: 5,
    });
  });
});
