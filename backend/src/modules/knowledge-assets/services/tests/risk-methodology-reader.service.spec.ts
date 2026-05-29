/**
 * Phase 7.17 — Prompt 1, B.2 unit tests.
 *
 * Covers all 12 cases from the approved plan:
 *
 *   1.  Valid content returns {likelihood, impact}
 *   2.  content is null → null + audit
 *   3.  content.risk_methodology missing → null + audit
 *   4.  category missing/empty → null + audit
 *   5.  category doesn't match any risk_categories row → null + audit
 *   6.  category matches an INACTIVE row → null + audit
 *   7.  likelihood is a string ("4") → null + audit
 *   8.  likelihood out of range (0 or 6) → null + audit
 *   9.  impact is a float (3.5) → null + audit
 *   10. notes is a non-string value → null + audit
 *   11. All fields valid, notes omitted → {likelihood, impact}
 *   12. Audit log insert throws → reader still returns null
 *
 * Pure unit tests — no Nest HTTP, no real DB. Mock repos for both the
 * risk_categories lookup and the audit_logs insert. Pattern follows
 * `risk-methodology-resolver.service.spec.ts` (the canonical unit-spec
 * pattern for the risk-analysis area established in B.1).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  AuditLog,
  KnowledgeAsset,
  RiskCategory,
} from '../../../../database/entities';
import { RiskMethodologyReaderService } from '../risk-methodology-reader.service';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures (UUID v4 shape)
// ─────────────────────────────────────────────────────────────────────────

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORY = 'Performance Bond';

// ─────────────────────────────────────────────────────────────────────────
// Repo mocks
// ─────────────────────────────────────────────────────────────────────────

const mockRiskCategoryRepo = {
  findOne: jest.fn(),
};

const mockAuditLogRepo = {
  insert: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────
// Asset factory — build a KnowledgeAsset with sensible defaults that
// the test overrides per case via `content` override.
// ─────────────────────────────────────────────────────────────────────────

function makeAsset(content: unknown): KnowledgeAsset {
  return {
    id: ASSET_ID,
    organization_id: ORG_ID,
    title: 'Test methodology asset',
    is_risk_methodology_source: true,
    risk_methodology_category: CATEGORY,
    content,
  } as KnowledgeAsset;
}

function validMethodologyBlock(overrides: Record<string, unknown> = {}) {
  return {
    risk_methodology: {
      category: CATEGORY,
      likelihood: 4,
      impact: 5,
      notes: 'PMBOK aligned',
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────

describe('RiskMethodologyReaderService.parse', () => {
  let service: RiskMethodologyReaderService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: audit insert succeeds.
    mockAuditLogRepo.insert.mockResolvedValue({
      identifiers: [{ id: 'audit-uuid' }],
    });
    // Default: category lookup returns the active row.
    mockRiskCategoryRepo.findOne.mockResolvedValue({
      id: 'cat-uuid',
      name: CATEGORY,
      is_active: true,
    } as RiskCategory);

    module = await Test.createTestingModule({
      providers: [
        RiskMethodologyReaderService,
        { provide: getRepositoryToken(RiskCategory), useValue: mockRiskCategoryRepo },
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditLogRepo },
      ],
    }).compile();

    service = module.get(RiskMethodologyReaderService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Happy paths (cases 1, 11)
  // ──────────────────────────────────────────────────────────────────────

  describe('Happy path', () => {
    it('case 1 — returns {likelihood, impact} for fully valid content (all 4 fields incl. notes)', async () => {
      const asset = makeAsset(validMethodologyBlock());
      const result = await service.parse(asset);
      expect(result).toEqual({ likelihood: 4, impact: 5 });
      expect(mockAuditLogRepo.insert).not.toHaveBeenCalled();
      // Verify the category lookup uses the active filter.
      expect(mockRiskCategoryRepo.findOne).toHaveBeenCalledWith({
        where: { name: CATEGORY, is_active: true },
      });
    });

    it('case 11 — returns {likelihood, impact} when notes is omitted (notes is optional)', async () => {
      const asset = makeAsset({
        risk_methodology: { category: CATEGORY, likelihood: 3, impact: 3 },
      });
      const result = await service.parse(asset);
      expect(result).toEqual({ likelihood: 3, impact: 3 });
      expect(mockAuditLogRepo.insert).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Content / block shape failures (cases 2, 3)
  // ──────────────────────────────────────────────────────────────────────

  describe('Content / block shape failures', () => {
    it('case 2 — returns null and audits when content is null', async () => {
      const asset = makeAsset(null);
      const result = await service.parse(asset);
      expect(result).toBeNull();
      expectMalformedAudit('content_missing');
    });

    // Case 3 has 3 sub-variants: missing key, null value, primitive.
    // Variants of "risk_methodology is missing or not a non-null object"
    // collapse under the same reason.
    it.each([
      ['key missing entirely', { other_fields: 'present' }],
      ['key is null', { risk_methodology: null }],
      ['key is a string', { risk_methodology: 'not an object' }],
      ['key is an array', { risk_methodology: [1, 2, 3] }],
    ])(
      'case 3 — returns null and audits when content.risk_methodology %s',
      async (_label, content) => {
        const asset = makeAsset(content);
        const result = await service.parse(asset);
        expect(result).toBeNull();
        expectMalformedAudit('risk_methodology_missing_or_not_object');
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Field-level failures (cases 4, 7, 8, 9, 10)
  // ──────────────────────────────────────────────────────────────────────

  describe('Field-level failures', () => {
    it.each([
      ['missing', { likelihood: 4, impact: 5 }],
      ['empty string', { category: '', likelihood: 4, impact: 5 }],
      ['whitespace only', { category: '   ', likelihood: 4, impact: 5 }],
      ['non-string', { category: 42, likelihood: 4, impact: 5 }],
    ])(
      'case 4 — returns null and audits when category is %s',
      async (_label, methodology) => {
        const asset = makeAsset({ risk_methodology: methodology });
        const result = await service.parse(asset);
        expect(result).toBeNull();
        expectMalformedAudit('category_missing_or_invalid');
      },
    );

    it('case 7 — returns null and audits when likelihood is a string ("4")', async () => {
      const asset = makeAsset({
        risk_methodology: { category: CATEGORY, likelihood: '4', impact: 5 },
      });
      const result = await service.parse(asset);
      expect(result).toBeNull();
      expectMalformedAudit('likelihood_invalid');
    });

    it.each([0, 6, -1, 100])(
      'case 8 — returns null and audits when likelihood is out of range (%i)',
      async (badValue) => {
        const asset = makeAsset({
          risk_methodology: { category: CATEGORY, likelihood: badValue, impact: 5 },
        });
        const result = await service.parse(asset);
        expect(result).toBeNull();
        expectMalformedAudit('likelihood_invalid');
      },
    );

    it('case 9 — returns null and audits when impact is a non-integer (3.5)', async () => {
      const asset = makeAsset({
        risk_methodology: { category: CATEGORY, likelihood: 4, impact: 3.5 },
      });
      const result = await service.parse(asset);
      expect(result).toBeNull();
      expectMalformedAudit('impact_invalid');
    });

    it.each([
      ['number', 42],
      ['object', { wrapped: 'note' }],
      ['array', ['line1', 'line2']],
      ['boolean', true],
    ])(
      'case 10 — returns null and audits when notes is a %s',
      async (_label, badNotes) => {
        const asset = makeAsset({
          risk_methodology: {
            category: CATEGORY,
            likelihood: 4,
            impact: 5,
            notes: badNotes,
          },
        });
        const result = await service.parse(asset);
        expect(result).toBeNull();
        expectMalformedAudit('notes_not_string');
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Category-lookup failures (cases 5, 6)
  // ──────────────────────────────────────────────────────────────────────

  describe('Category-lookup failures', () => {
    it('case 5 — returns null and audits when category does not match any risk_categories row', async () => {
      mockRiskCategoryRepo.findOne.mockResolvedValue(undefined);
      const asset = makeAsset({
        risk_methodology: { category: 'Bogus Category', likelihood: 4, impact: 5 },
      });
      const result = await service.parse(asset);
      expect(result).toBeNull();
      expectMalformedAudit('category_not_recognized');
      // Confirm the WHERE clause filtered on is_active = true.
      expect(mockRiskCategoryRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'Bogus Category', is_active: true },
      });
    });

    it('case 6 — returns null and audits when category matches an INACTIVE risk_categories row', async () => {
      // The reader's WHERE clause filters on is_active = true, so an
      // inactive row is indistinguishable from "no row found". The
      // mock returns undefined to simulate this — and we assert the
      // WHERE clause shape so a future change that drops the is_active
      // filter would fail this test.
      mockRiskCategoryRepo.findOne.mockResolvedValue(undefined);
      const asset = makeAsset({
        risk_methodology: {
          category: 'Inactive Category',
          likelihood: 4,
          impact: 5,
        },
      });
      const result = await service.parse(asset);
      expect(result).toBeNull();
      expectMalformedAudit('category_not_recognized');
      expect(mockRiskCategoryRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'Inactive Category', is_active: true },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Audit-write failure swallowed (case 12)
  // ──────────────────────────────────────────────────────────────────────

  describe('Audit-write failure swallowed', () => {
    it('case 12 — returns null cleanly even when audit log insert throws', async () => {
      mockAuditLogRepo.insert.mockRejectedValue(new Error('connection refused'));
      // Trigger a malformed-content path so recordMalformed gets called.
      const asset = makeAsset(null);

      // The KEY assertion: parse() resolves to null, does NOT reject.
      const result = await service.parse(asset);
      expect(result).toBeNull();
      // The audit-log insert WAS attempted before its failure was
      // swallowed.
      expect(mockAuditLogRepo.insert).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test helper — asserts the audit-log insert was called with the
// canonical KB_RISK_REFERENCE_MALFORMED shape and the given reason.
// ─────────────────────────────────────────────────────────────────────────

function expectMalformedAudit(expectedReason: string): void {
  expect(mockAuditLogRepo.insert).toHaveBeenCalledTimes(1);
  expect(mockAuditLogRepo.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'KB_RISK_REFERENCE_MALFORMED',
      entity_type: 'knowledge_asset',
      entity_id: ASSET_ID,
      organization_id: ORG_ID,
      new_values: expect.objectContaining({ reason: expectedReason }),
    }),
  );
}
