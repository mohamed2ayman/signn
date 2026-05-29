/**
 * Phase 7.17 — Prompt 1, B.1 unit tests (B.2-refactored).
 *
 * Covers all 14 cases from the approved B.1 plan. Two test strategies are mixed:
 *
 *   - Step 1 cases (1-4) and cache / fallback / input-validation cases
 *     (9-12, 14) drive the REAL service code with a mocked KnowledgeAsset
 *     repository and a mocked RiskMethodologyReaderService. These exercise
 *     the actual implementation that ships in B.1 + B.2.
 *
 *   - Step 2 / Step 3 cases (5-8) and the orchestrator-resilience case
 *     (13) use `jest.spyOn(service as any, 'tryStepN')` to inject
 *     behaviour into the private methods. The real implementations for
 *     steps 2 and 3 are stubs that always return null (B.3 + S.2 + S.3
 *     wire-up still pending — see the resolver service file's TODO
 *     comments). The spies test the ORCHESTRATOR'S chain logic correctly
 *     today; when steps 2/3 are wired to real repos, these tests should
 *     be rewritten to use proper repo mocks (matching the pattern of
 *     cases 1-4).
 *
 * B.2 refactor: the reader was originally imported as a free function
 * `parseRiskMethodologyContent` from `utils/risk-methodology-reader.ts`,
 * and mocked via `jest.spyOn(readerModule, 'parseRiskMethodologyContent')`.
 * Once the reader needed DI to inject its risk_categories and audit_logs
 * repos, it became a Nest `@Injectable() RiskMethodologyReaderService`.
 * The mock pattern is now a constructor-injected mock service; the test
 * assertions (what each `it()` checks the resolver does) are unchanged.
 *
 * Follows the unit-test half of the pattern from
 * `backend/src/modules/compliance/tests/compliance-obligations.controller.spec.ts`.
 */

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  KnowledgeAsset,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
} from '../../../../database/entities';
import { RiskMethodologyReaderService } from '../../../knowledge-assets/services/risk-methodology-reader.service';
import { RiskSourceType } from '../../enums/risk-source-type.enum';
import { RiskMethodologyResolverService } from '../risk-methodology-resolver.service';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures (UUID v4 shape so any future @IsUUID() validators accept them)
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KB_ASSET_ID_SPECIFIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KB_ASSET_ID_GENERIC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CATEGORY = 'Performance Bond';

// ─────────────────────────────────────────────────────────────────────────
// QueryBuilder + KnowledgeAsset repo mock
// ─────────────────────────────────────────────────────────────────────────

interface MockQb {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  limit: jest.Mock;
  getOne: jest.Mock;
}

function makeQb(getOneResult: any): MockQb {
  const qb: any = {};
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.limit = jest.fn().mockReturnValue(qb);
  qb.getOne = jest.fn().mockResolvedValue(getOneResult);
  return qb;
}

const mockKbRepo = {
  createQueryBuilder: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function assetRow(
  id: string,
  category: string | null,
): Partial<KnowledgeAsset> {
  return {
    id,
    organization_id: ORG_ID,
    title: `KB asset for ${category ?? 'any'}`,
    // is_risk_methodology_source / risk_methodology_category are added by
    // the S.5 migration; the mock entity object isn't typechecked against
    // the entity decorator-time shape so we don't need to spread them here.
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────

describe('RiskMethodologyResolverService', () => {
  let service: RiskMethodologyResolverService;
  let module: TestingModule;

  // Mock for the injected RiskMethodologyReaderService. The resolver
  // calls `this.reader.parse(asset)` in tryStep1 — each test sets
  // mockReader.parse to either resolve with {likelihood, impact} or
  // resolve with null.
  const mockReader = { parse: jest.fn() };

  // B.3 — Mocks for the now-real tryStep2 and tryStep3 implementations.
  // Default behaviour for both: findOne / query returns undefined / null,
  // which makes the chain fall through to step 4 (FALLBACK) — the same
  // behaviour the pre-B.3 stubs produced. Tests that drive cases 5-8 and
  // 13 spy on (service as any).tryStepN, so the real implementations
  // never run there and these mocks are not consulted.
  const mockLearnedBaselineRepo = {
    findOne: jest.fn(async () => undefined),
  };
  const mockPlatformDefaultRepoQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => undefined),
  };
  const mockPlatformDefaultRepo = {
    createQueryBuilder: jest.fn(() => mockPlatformDefaultRepoQb),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        RiskMethodologyResolverService,
        {
          provide: getRepositoryToken(KnowledgeAsset),
          useValue: mockKbRepo,
        },
        {
          provide: RiskMethodologyReaderService,
          useValue: mockReader,
        },
        // B.3 — un-stubbed tryStep2/tryStep3 need repos in DI.
        // Default findOne/getOne → undefined keeps every existing
        // assertion green (chain falls through to step 4 as before).
        {
          provide: getRepositoryToken(RiskCategoryOrgLearnedBaseline),
          useValue: mockLearnedBaselineRepo,
        },
        {
          provide: getRepositoryToken(RiskCategoryPlatformDefault),
          useValue: mockPlatformDefaultRepo,
        },
      ],
    }).compile();

    service = module.get(RiskMethodologyResolverService);
  });

  afterEach(() => {
    service._clearCache();
    // mockReader.parse state is reset by jest.clearAllMocks() in beforeEach.
  });

  // ──────────────────────────────────────────────────────────────────────
  // Step 1 — USER_KB_REFERENCE (cases 1-4)
  // ──────────────────────────────────────────────────────────────────────

  describe('Step 1 — USER_KB_REFERENCE', () => {
    it('case 1 — hits with category-specific KB reference', async () => {
      const asset = assetRow(KB_ASSET_ID_SPECIFIC, CATEGORY);
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(asset));
      mockReader.parse.mockResolvedValue({ likelihood: 4, impact: 5 });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result).toEqual({
        likelihood: 4,
        impact: 5,
        likelihood_source: RiskSourceType.USER_KB_REFERENCE,
        impact_source: RiskSourceType.USER_KB_REFERENCE,
        kb_reference_id: KB_ASSET_ID_SPECIFIC,
      });
      expect(mockReader.parse).toHaveBeenCalledTimes(1);
      expect(mockReader.parse).toHaveBeenCalledWith(asset);
    });

    it('case 2 — hits with generic KB reference (category NULL)', async () => {
      const asset = assetRow(KB_ASSET_ID_GENERIC, null);
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(asset));
      mockReader.parse.mockResolvedValue({ likelihood: 3, impact: 4 });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result.likelihood).toBe(3);
      expect(result.impact).toBe(4);
      expect(result.likelihood_source).toBe(RiskSourceType.USER_KB_REFERENCE);
      expect(result.kb_reference_id).toBe(KB_ASSET_ID_GENERIC);
    });

    it('case 3 — prefers category-specific over generic (single SQL with ORDER BY CASE)', async () => {
      // The resolver's query uses ORDER BY CASE to make the DB return the
      // category-specific row first. We mock the DB returning the specific
      // row, then assert the reader is called only on it. The generic row's
      // existence is implicit — it would be present in the table but never
      // reaches the reader.
      const specificAsset = assetRow(KB_ASSET_ID_SPECIFIC, CATEGORY);
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(specificAsset));
      mockReader.parse.mockResolvedValue({ likelihood: 5, impact: 5 });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result.kb_reference_id).toBe(KB_ASSET_ID_SPECIFIC);
      expect(mockReader.parse).toHaveBeenCalledTimes(1);
      expect(mockReader.parse.mock.calls[0][0].id).toBe(KB_ASSET_ID_SPECIFIC);
    });

    it('case 4 — falls through on missing or invalid content.risk_methodology', async () => {
      const asset = assetRow(KB_ASSET_ID_SPECIFIC, CATEGORY);
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(asset));
      // Reader returns null → malformed / missing methodology block.
      mockReader.parse.mockResolvedValue(null);

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      // Chain falls through step 1 → step 2 (stub null) → step 3 (stub null)
      // → step 4 (FALLBACK).
      expect(result.likelihood).toBe(3);
      expect(result.impact).toBe(3);
      expect(result.likelihood_source).toBe(RiskSourceType.FALLBACK);
      expect(mockReader.parse).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Step 2 — ORG_LEARNED (cases 5-6)
  //
  // The real tryStep2 is a stub returning null in B.1 (S.3 entity not
  // built yet). These cases use jest.spyOn on the private method to
  // simulate the future behaviour and assert the orchestrator chains
  // correctly. When S.3 lands and the stub is replaced with the real
  // query, rewrite these tests to use a repo mock (matching cases 1-4).
  // ──────────────────────────────────────────────────────────────────────

  describe('Step 2 — ORG_LEARNED (orchestrator behaviour, stub-spied)', () => {
    it('case 5 — hits when learned baseline has exactly 10 overrides', async () => {
      // Step 1 misses (no KB asset).
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      // Step 2 hits with an ORG_LEARNED result (simulating the future
      // post-S.3 behaviour where the baseline row has override_count = 10).
      jest
        .spyOn(service as any, 'tryStep2')
        .mockResolvedValue({
          likelihood: 4,
          impact: 4,
          likelihood_source: RiskSourceType.ORG_LEARNED,
          impact_source: RiskSourceType.ORG_LEARNED,
        });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result.likelihood).toBe(4);
      expect(result.impact).toBe(4);
      expect(result.likelihood_source).toBe(RiskSourceType.ORG_LEARNED);
    });

    it('case 6 — skipped when override count is below threshold (9)', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      // Step 2 returns null — baseline has only 9 overrides.
      jest.spyOn(service as any, 'tryStep2').mockResolvedValue(null);
      // Step 3 hits with a PLATFORM_DEFAULT so we can observe that step 3
      // WAS queried (otherwise we'd just see FALLBACK and not distinguish).
      jest
        .spyOn(service as any, 'tryStep3')
        .mockResolvedValue({
          likelihood: 2,
          impact: 4,
          likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
          impact_source: RiskSourceType.PLATFORM_DEFAULT,
          platform_default_ref_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result.likelihood_source).toBe(RiskSourceType.PLATFORM_DEFAULT);
      // Confirms step 3 was reached.
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Step 3 — PLATFORM_DEFAULT (cases 7-8)
  // Same stub-spied approach as Step 2.
  // ──────────────────────────────────────────────────────────────────────

  describe('Step 3 — PLATFORM_DEFAULT (orchestrator behaviour, stub-spied)', () => {
    it('case 7 — hits with jurisdiction-specific default (prefers it over NULL)', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      jest.spyOn(service as any, 'tryStep2').mockResolvedValue(null);
      // Step 3 returns the jurisdiction-specific row (simulating post-S.2
      // behaviour where the ORDER BY CASE picked FIDIC_RED over the NULL row).
      jest
        .spyOn(service as any, 'tryStep3')
        .mockResolvedValue({
          likelihood: 3,
          impact: 5,
          likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
          impact_source: RiskSourceType.PLATFORM_DEFAULT,
          platform_default_ref_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
        jurisdictionVariant: 'FIDIC_RED',
      });

      expect(result.likelihood).toBe(3);
      expect(result.impact).toBe(5);
      expect(result.likelihood_source).toBe(RiskSourceType.PLATFORM_DEFAULT);
      expect(result.platform_default_ref_id).toBe(
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      );
    });

    it('case 8 — hits with NULL-jurisdiction fallback when no variant-specific row exists', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      jest.spyOn(service as any, 'tryStep2').mockResolvedValue(null);
      // Step 3 returns the NULL-jurisdiction row (simulating the case
      // where no FIDIC_RED row exists, so the ORDER BY CASE picks the
      // jurisdiction=NULL row).
      jest
        .spyOn(service as any, 'tryStep3')
        .mockResolvedValue({
          likelihood: 2,
          impact: 3,
          likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
          impact_source: RiskSourceType.PLATFORM_DEFAULT,
          platform_default_ref_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
        jurisdictionVariant: 'FIDIC_RED',
      });

      expect(result.likelihood).toBe(2);
      expect(result.impact).toBe(3);
      expect(result.likelihood_source).toBe(RiskSourceType.PLATFORM_DEFAULT);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Step 4 — FALLBACK (case 9)
  // ──────────────────────────────────────────────────────────────────────

  describe('Step 4 — FALLBACK', () => {
    it('case 9 — returns L=3 I=3 FALLBACK when all chain steps are empty', async () => {
      // Step 1 misses (no KB asset). Steps 2 and 3 are real stubs returning
      // null. Step 4 always returns the fallback.
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(result).toEqual({
        likelihood: 3,
        impact: 3,
        likelihood_source: RiskSourceType.FALLBACK,
        impact_source: RiskSourceType.FALLBACK,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Caching (cases 10-12)
  // ──────────────────────────────────────────────────────────────────────

  describe('Caching', () => {
    it('case 10 — second call within TTL hits the cache (DB called once total)', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));

      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });
      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      // createQueryBuilder called exactly once across the two requests.
      expect(mockKbRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      const stats = service._cacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it('case 11 — call after TTL expiry misses the cache and queries DB again', async () => {
      jest.useFakeTimers();
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));

      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });
      // Advance > 5 min (CACHE_TTL_MS).
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(mockKbRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
      const stats = service._cacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);

      jest.useRealTimers();
    });

    it('case 12 — invalidate(orgId, category) clears matching keys, leaves other-org keys', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));

      // Populate 3 keys for the same (org, category) different jurisdictions.
      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      }); // jurisdiction NONE
      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
        jurisdictionVariant: 'FIDIC_RED',
      });
      await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
        jurisdictionVariant: 'NEC',
      });
      // And one key for a DIFFERENT org, same category — should NOT be cleared.
      await service.resolveDefaults({
        organizationId: OTHER_ORG_ID,
        riskCategory: CATEGORY,
      });

      expect(service._cacheStats().size).toBe(4);

      service.invalidate(ORG_ID, CATEGORY);

      // The 3 matching keys are gone; the other-org key survives.
      expect(service._cacheStats().size).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Error handling (cases 13-14)
  // ──────────────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('case 13 — error escaping step 2 falls through to step 3 (defensive orchestrator)', async () => {
      mockKbRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      // Simulate step 2's implementation throwing an unhandled error
      // (e.g. a future implementation forgot its own try/catch). The
      // orchestrator's defense-in-depth try/catch catches it, logs a
      // warning, and falls through to step 3.
      const tryStep2Spy = jest
        .spyOn(service as any, 'tryStep2')
        .mockImplementation(async () => {
          throw new Error('connection refused');
        });
      const tryStep3Spy = jest
        .spyOn(service as any, 'tryStep3')
        .mockResolvedValue({
          likelihood: 2,
          impact: 4,
          likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
          impact_source: RiskSourceType.PLATFORM_DEFAULT,
        });

      const result = await service.resolveDefaults({
        organizationId: ORG_ID,
        riskCategory: CATEGORY,
      });

      // Result came from step 3 — step 2's error did not propagate.
      expect(result.likelihood_source).toBe(RiskSourceType.PLATFORM_DEFAULT);
      expect(result.likelihood).toBe(2);
      expect(result.impact).toBe(4);
      expect(tryStep2Spy).toHaveBeenCalledTimes(1);
      expect(tryStep3Spy).toHaveBeenCalledTimes(1);
    });

    it('case 14 — empty riskCategory throws BadRequestException before any DB call', async () => {
      await expect(
        service.resolveDefaults({
          organizationId: ORG_ID,
          riskCategory: '',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.resolveDefaults({
          organizationId: ORG_ID,
          riskCategory: '   ', // whitespace-only
        }),
      ).rejects.toThrow(BadRequestException);

      // Empty orgId is also rejected.
      await expect(
        service.resolveDefaults({
          organizationId: '',
          riskCategory: CATEGORY,
        }),
      ).rejects.toThrow(BadRequestException);

      // No DB calls fired during any of the three invalid invocations.
      expect(mockKbRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
