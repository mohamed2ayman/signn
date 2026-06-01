/**
 * Phase 7.24a — Knowledge Base Search Enhancements
 *
 * Covers the three new findAll() search paths:
 *
 *   1. Jurisdiction filter — andWhere called with exact-match predicate
 *   2. Tag filter — andWhere called with @> (contains-all) JSONB predicate
 *   3. Text search — andWhere includes content->>'summary' in the ILIKE clause
 *
 * Pure unit tests — no Nest HTTP, no real DB.
 * Mock repo returns the value configured per-test via mockQb.getMany.
 * Each test gets a fresh mockQb (created inside beforeEach) so call counts
 * are always clean.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { KnowledgeAsset, KnowledgeAssetUsage, KnowledgeAssetVersion } from '../../database/entities';
import { KnowledgeAssetsService } from './knowledge-assets.service';
import { StorageService } from '../storage/storage.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeAsset(overrides: Partial<KnowledgeAsset> = {}): KnowledgeAsset {
  return {
    id: 'asset-uuid-1',
    title: 'Egyptian Construction Law',
    description: 'Key articles on construction liability',
    jurisdiction: 'EG',
    tags: ['type:PLAYBOOK', 'jurisdiction:EG'],
    content: { summary: 'performance bond requirements and guarantees' } as any,
    organization_id: ORG_ID,
    asset_type: 'LAW' as any,
    review_status: 'AUTO_APPROVED' as any,
    embedding_status: 'COMPLETED',
    ocr_status: 'SKIPPED',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  } as KnowledgeAsset;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage service mock (constructor dependency — never called in these tests)
// ─────────────────────────────────────────────────────────────────────────────

const mockStorageService = {
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('KnowledgeAssetsService.findAll — search enhancements', () => {
  let service: KnowledgeAssetsService;
  let mockQb: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(async () => {
    // Fresh query-builder mock per test — ensures call counts start at 0.
    mockQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeAssetsService,
        {
          provide: getRepositoryToken(KnowledgeAsset),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQb),
          },
        },
        { provide: StorageService, useValue: mockStorageService },
        {
          provide: getRepositoryToken(KnowledgeAssetUsage),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), insert: jest.fn() },
        },
        {
          // Phase 7.24d — version snapshot repository mock
          provide: getRepositoryToken(KnowledgeAssetVersion),
          useValue: {
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<KnowledgeAssetsService>(KnowledgeAssetsService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1 — jurisdiction filter
  // ──────────────────────────────────────────────────────────────────────────

  it('jurisdiction filter — andWhere called with exact-match predicate and filtered assets returned', async () => {
    const asset = makeAsset({ jurisdiction: 'EG' });
    mockQb.getMany.mockResolvedValueOnce([asset]);

    const result = await service.findAll(ORG_ID, { jurisdiction: 'EG' });

    expect(result).toEqual([asset]);
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'asset.jurisdiction = :jurisdiction',
      { jurisdiction: 'EG' },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2 — tag filter
  // ──────────────────────────────────────────────────────────────────────────

  it('tag filter — andWhere called with @> JSONB containment predicate and matching assets returned', async () => {
    const asset = makeAsset({ tags: ['type:PLAYBOOK', 'standard:FIDIC_RED_BOOK_2017'] });
    mockQb.getMany.mockResolvedValueOnce([asset]);

    const result = await service.findAll(ORG_ID, { tags: ['type:PLAYBOOK'] });

    expect(result).toEqual([asset]);
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'asset.tags @> :tags::jsonb',
      { tags: JSON.stringify(['type:PLAYBOOK']) },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3 — content summary in text search
  // ──────────────────────────────────────────────────────────────────────────

  it("text search — andWhere includes content->>'summary' in the ILIKE clause", async () => {
    const asset = makeAsset({
      content: { summary: 'performance bond requirements and guarantees' } as any,
    });
    mockQb.getMany.mockResolvedValueOnce([asset]);

    const result = await service.findAll(ORG_ID, { search: 'performance bond' });

    expect(result).toEqual([asset]);

    // The andWhere call for the search filter must include all three fields:
    // title, description, and content->>'summary'.
    const searchCall = mockQb.andWhere.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' &&
        (args[0] as string).includes("content->>'summary'"),
    );
    expect(searchCall).toBeDefined();

    // Also assert the other two fields are present in the same expression.
    const searchExpr = searchCall![0] as string;
    expect(searchExpr).toContain('asset.title ILIKE');
    expect(searchExpr).toContain('asset.description ILIKE');
  });
});
