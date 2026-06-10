/**
 * Phase 7.27 — Unit tests for LegalDocumentsService.
 *
 * Focus areas:
 *  1. createWithUpload() — deduplication guard (409 on same content_hash)
 *  2. findAll() — pagination defaults and filter forwarding
 *  3. findById() — 404 when not found
 *  4. remove() — calls storage.deleteFile + docRepo.delete
 *  5. retrieveRelevantChunks() — passes parameterized query to DataSource,
 *     excludes REPEALED documents, returns shaped results
 *
 * All external I/O (TypeORM repos, DataSource, StorageService, AiService)
 * is mocked — no real database or HTTP calls.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { LegalDocumentsService } from '../legal-documents.service';
import { BadRequestException } from '@nestjs/common';
import {
  LegalDocument,
  LegalDocumentChunk,
  LegalDocumentEmbeddingStatus,
  LegalDocumentStatus,
  LegalDocumentSourceType,
  LegalSource,
} from '../../../database/entities';
import { StorageService } from '../../storage/storage.service';
import { AiService } from '../../ai/ai.service';
import { CreateLegalDocumentDto } from '../dto/create-legal-document.dto';
import { ListLegalDocumentsDto } from '../dto/list-legal-documents.dto';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DOC: LegalDocument = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  jurisdiction: 'EG',
  source_type: LegalDocumentSourceType.PRIMARY_TEXT,
  title: 'Egyptian Civil Code',
  law_number: '131',
  law_year: 1948,
  gregorian_date: null,
  hijri_date: null,
  status: LegalDocumentStatus.IN_FORCE,
  language: ['AR'],
  parent_law_id: null,
  parent_law: null,
  child_documents: [],
  file_url: 'http://localhost:3000/uploads/legal-documents/abc123.pdf',
  file_name: 'civil-code.pdf',
  content_hash: 'abc123deadbeef',
  source_url: null,
  source_attribution: null,
  embedding_status: LegalDocumentEmbeddingStatus.PENDING,
  error_message: null,
  extracted_text: 'مادة (1)\nالعقد هو...',
  extraction_job_id: null,
  embedding_job_id: null,
  created_by: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
} as unknown as LegalDocument;

const MOCK_SOURCE_ID = 'src00000-0000-0000-0000-000000000001';

const MOCK_SOURCE_LOGICAL: LegalSource = {
  id: MOCK_SOURCE_ID,
  name: 'Generic Logical Source',
  base_url: null,
  jurisdiction: 'EG',
  is_visual_order: false,
  force_ocr: false,
  notes: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
} as unknown as LegalSource;

const MOCK_SOURCE_VISUAL: LegalSource = {
  ...MOCK_SOURCE_LOGICAL,
  id: 'src00000-0000-0000-0000-0000000000ff',
  name: 'Generic Visual-Order Source',
  base_url: 'example.gov',
  is_visual_order: true,
  force_ocr: false,
} as unknown as LegalSource;

const MOCK_SOURCE_OCR: LegalSource = {
  ...MOCK_SOURCE_LOGICAL,
  id: 'src00000-0000-0000-0000-0000000000aa',
  name: 'Egyptian Tax Authority',
  base_url: 'eta.gov.eg',
  is_visual_order: false, // OCR is logical-order natively
  force_ocr: true,
} as unknown as LegalSource;

const MOCK_CREATE_DTO: CreateLegalDocumentDto = {
  jurisdiction: 'EG',
  source_type: LegalDocumentSourceType.PRIMARY_TEXT,
  title: 'Egyptian Civil Code',
  law_number: '131',
  law_year: 1948,
  source_id: MOCK_SOURCE_ID,
};

const MOCK_FILE: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'civil-code.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('PDF content'),
  size: 11,
} as Express.Multer.File;

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockDocRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockChunkRepo = {
  save: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
};

const mockSourceRepo = {
  findOne: jest.fn(),
};

const mockDataSource = {
  query: jest.fn(),
};

const mockStorageService = {
  uploadBuffer: jest.fn(),
  deleteFile: jest.fn(),
  getLocalPathOrNull: jest.fn().mockReturnValue('/app/uploads/legal-documents/abc123.pdf'),
};

const mockAiService = {
  // Phase E: createWithUpload now dispatches a single ingestion task.
  triggerIngestLegalDocument: jest.fn().mockResolvedValue({
    job_id: 'ingest-job-001',
    status: 'queued',
  }),
  getJobStatus: jest.fn(),
  embedQuery: jest.fn(),
};

// ─── Setup ─────────────────────────────────────────────────────────────────────

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      LegalDocumentsService,
      { provide: getRepositoryToken(LegalDocument), useValue: mockDocRepo },
      { provide: getRepositoryToken(LegalDocumentChunk), useValue: mockChunkRepo },
      { provide: getRepositoryToken(LegalSource), useValue: mockSourceRepo },
      { provide: getDataSourceToken(), useValue: mockDataSource },
      { provide: StorageService, useValue: mockStorageService },
      { provide: AiService, useValue: mockAiService },
    ],
  }).compile();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('LegalDocumentsService', () => {
  let service: LegalDocumentsService;

  beforeEach(async () => {
    const module = await buildModule();
    service = module.get<LegalDocumentsService>(LegalDocumentsService);
    jest.clearAllMocks();
  });

  // ── createWithUpload ────────────────────────────────────────────────────────

  describe('createWithUpload', () => {
    it('throws ConflictException when a document with the same content_hash already exists', async () => {
      // Simulate dedup guard: findOne returns an existing doc
      mockDocRepo.findOne.mockResolvedValueOnce(MOCK_DOC);

      await expect(
        service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001'),
      ).rejects.toThrow(ConflictException);

      // Storage upload must NOT have been called
      expect(mockStorageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('creates a new document when no hash collision exists', async () => {
      const newDoc = { ...MOCK_DOC, id: 'new-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null); // no existing doc
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_LOGICAL);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      // docRepo.create() returns a partial entity; docRepo.save() persists it
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.createWithUpload(
        MOCK_CREATE_DTO,
        MOCK_FILE,
        'user-uuid-001',
      );

      expect(result.id).toBe('new-uuid');
      expect(mockStorageService.uploadBuffer).toHaveBeenCalledTimes(1);
      expect(mockDocRepo.create).toHaveBeenCalledTimes(1);
      expect(mockDocRepo.save).toHaveBeenCalledTimes(1);
    });

    it('dispatches a single ai-backend ingestion task after creating the row (Phase E)', async () => {
      const newDoc = { ...MOCK_DOC, id: 'dispatch-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null);
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_LOGICAL);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      await service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001');

      // The dispatch is fire-and-forget (.catch) — flush the microtask queue
      // so the floating promise settles before we assert.
      await new Promise((resolve) => setImmediate(resolve));

      // is_visual_order=false + force_ocr=false (logical source) are forwarded.
      expect(mockAiService.triggerIngestLegalDocument).toHaveBeenCalledWith(
        'dispatch-uuid',
        false,
        false,
      );
      // The legacy two-step flow must NOT be used anymore.
      expect(mockAiService.getJobStatus).not.toHaveBeenCalled();
    });

    it('forwards is_visual_order=true when the source is flagged visual-order', async () => {
      const newDoc = { ...MOCK_DOC, id: 'visual-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null);
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_VISUAL);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      await service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockAiService.triggerIngestLegalDocument).toHaveBeenCalledWith(
        'visual-uuid',
        true,
        false,
      );
    });

    it('forwards is_visual_order=false when the source is flagged logical-order', async () => {
      const newDoc = { ...MOCK_DOC, id: 'logical-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null);
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_LOGICAL);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      await service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockAiService.triggerIngestLegalDocument).toHaveBeenCalledWith(
        'logical-uuid',
        false,
        false,
      );
    });

    it('forwards force_ocr=true when the source is flagged force_ocr (ETA)', async () => {
      const newDoc = { ...MOCK_DOC, id: 'ocr-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null);
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_OCR);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      await service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001');
      await new Promise((resolve) => setImmediate(resolve));

      // force_ocr=true; is_visual_order=false (OCR is logical-order natively).
      expect(mockAiService.triggerIngestLegalDocument).toHaveBeenCalledWith(
        'ocr-uuid',
        false,
        true,
      );
    });

    it('forwards force_ocr=false for a normal text-layer source', async () => {
      const newDoc = { ...MOCK_DOC, id: 'noocr-uuid' };
      mockDocRepo.findOne.mockResolvedValueOnce(null);
      mockSourceRepo.findOne.mockResolvedValueOnce(MOCK_SOURCE_LOGICAL);
      mockStorageService.uploadBuffer.mockResolvedValueOnce({
        file_url: 'http://localhost:3000/uploads/legal-documents/hash.pdf',
        storage_key: 'legal-documents/hash.pdf',
      });
      mockDocRepo.create.mockReturnValueOnce(newDoc);
      mockDocRepo.save.mockResolvedValueOnce(newDoc);
      mockDocRepo.update.mockResolvedValue({ affected: 1 });

      await service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001');
      await new Promise((resolve) => setImmediate(resolve));

      const call = mockAiService.triggerIngestLegalDocument.mock.calls[0];
      expect(call[0]).toBe('noocr-uuid');
      expect(call[2]).toBe(false); // force_ocr
    });

    it('throws BadRequestException when source_id does not exist (no document created)', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(null); // dedup passes
      mockSourceRepo.findOne.mockResolvedValueOnce(null); // source not found

      await expect(
        service.createWithUpload(MOCK_CREATE_DTO, MOCK_FILE, 'user-uuid-001'),
      ).rejects.toThrow(BadRequestException);

      // No upload, no row, no dispatch when the source is invalid.
      expect(mockStorageService.uploadBuffer).not.toHaveBeenCalled();
      expect(mockDocRepo.save).not.toHaveBeenCalled();
      expect(mockAiService.triggerIngestLegalDocument).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated results with default page=1, limit=20', async () => {
      // findAll uses queryBuilder under the hood; mock getManyAndCount
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[MOCK_DOC], 1]),
      };
      mockDocRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const dto = new ListLegalDocumentsDto();
      dto.page = 1;
      dto.limit = 20;

      const result = await service.findAll(dto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('forwards jurisdiction filter to the repository query', async () => {
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      mockDocRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const dto = new ListLegalDocumentsDto();
      dto.jurisdiction = 'AE';
      dto.page = 1;
      dto.limit = 20;

      await service.findAll(dto);

      // The andWhere call for jurisdiction must include the value 'AE'
      const jurisdictionCall = mockQb.andWhere.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('jurisdiction'),
      );
      expect(jurisdictionCall).toBeDefined();
      expect(jurisdictionCall[1]).toMatchObject({ jurisdiction: 'AE' });
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('throws NotFoundException when document does not exist', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.findById('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the document when found', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(MOCK_DOC);

      const result = await service.findById(MOCK_DOC.id);
      expect(result.id).toBe(MOCK_DOC.id);
    });
  });

  // ── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the storage file and the DB row', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(MOCK_DOC);
      mockStorageService.deleteFile.mockResolvedValueOnce(undefined);
      mockDocRepo.delete.mockResolvedValueOnce({ affected: 1 });

      await service.remove(MOCK_DOC.id);

      expect(mockStorageService.deleteFile).toHaveBeenCalledWith(MOCK_DOC.file_url);
      expect(mockDocRepo.delete).toHaveBeenCalledWith(MOCK_DOC.id);
    });

    it('proceeds with DB delete even if storage.deleteFile throws (best-effort)', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(MOCK_DOC);
      mockStorageService.deleteFile.mockRejectedValueOnce(new Error('S3 error'));
      mockDocRepo.delete.mockResolvedValueOnce({ affected: 1 });

      // Must not throw
      await expect(service.remove(MOCK_DOC.id)).resolves.toBeUndefined();
      expect(mockDocRepo.delete).toHaveBeenCalledWith(MOCK_DOC.id);
    });

    it('throws NotFoundException when document does not exist', async () => {
      mockDocRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.remove('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── retrieveRelevantChunks ──────────────────────────────────────────────────

  describe('retrieveRelevantChunks', () => {
    const MOCK_VECTOR = Array.from({ length: 1536 }, (_, i) => i / 1536);

    const MOCK_ROWS = [
      {
        id: 'chunk-001',
        chunk_text: 'مادة (1) — الالتزامات العقدية',
        article_reference: 'مادة (1)',
        legal_document_id: MOCK_DOC.id,
        title: 'Egyptian Civil Code',
        law_number: '131',
        law_year: 1948,
        jurisdiction: 'EG',
        distance: '0.12',
      },
    ];

    beforeEach(() => {
      mockAiService.embedQuery.mockResolvedValue(MOCK_VECTOR);
      mockDataSource.query.mockResolvedValue(MOCK_ROWS);
    });

    it('calls aiService.embedQuery to convert query text to a vector', async () => {
      await service.retrieveRelevantChunks('قانون العقود', 'EG', 5);
      expect(mockAiService.embedQuery).toHaveBeenCalledWith('قانون العقود');
    });

    it('passes jurisdiction and topK as SQL parameters', async () => {
      await service.retrieveRelevantChunks('contract law', 'AE', 3);

      const [sql, params] = mockDataSource.query.mock.calls[0];
      // $2 = jurisdiction, $4 = topK
      expect(params[1]).toBe('AE');
      expect(params[3]).toBe(3);
    });

    it('includes REPEALED status exclusion as a SQL parameter', async () => {
      await service.retrieveRelevantChunks('contract law', 'EG', 5);

      const [, params] = mockDataSource.query.mock.calls[0];
      // $3 = LegalDocumentStatus.REPEALED
      expect(params[2]).toBe(LegalDocumentStatus.REPEALED);
    });

    it('passes the vector as $1 in parameterized form (never as string concat)', async () => {
      await service.retrieveRelevantChunks('query text', 'EG', 5);

      const [sql, params] = mockDataSource.query.mock.calls[0];
      // The SQL must reference $1::vector, not inline the vector literal
      expect(sql).toContain('$1::vector');
      // The first parameter must be the string representation of the vector
      expect(params[0]).toMatch(/^\[[\d.,\-\s]+\]$/);
    });

    it('returns shaped results with distance as a number', async () => {
      const results = await service.retrieveRelevantChunks('قانون', 'EG', 5);

      expect(results).toHaveLength(1);
      expect(results[0].chunk_text).toBe('مادة (1) — الالتزامات العقدية');
      expect(results[0].article_reference).toBe('مادة (1)');
      expect(typeof results[0].distance).toBe('number');
    });

    it('returns empty array when DataSource query returns no rows', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      const results = await service.retrieveRelevantChunks('no match', 'SA', 5);
      expect(results).toEqual([]);
    });
  });
});
