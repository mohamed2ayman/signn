import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, ILike } from 'typeorm';
import * as crypto from 'crypto';
import {
  LegalDocument,
  LegalDocumentChunk,
  LegalDocumentEmbeddingStatus,
  LegalDocumentStatus,
  LegalSource,
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AiService } from '../ai/ai.service';
import { CreateLegalDocumentDto } from './dto/create-legal-document.dto';
import { ListLegalDocumentsDto } from './dto/list-legal-documents.dto';

@Injectable()
export class LegalDocumentsService {
  private readonly logger = new Logger(LegalDocumentsService.name);

  constructor(
    @InjectRepository(LegalDocument)
    private readonly docRepo: Repository<LegalDocument>,

    @InjectRepository(LegalDocumentChunk)
    private readonly chunkRepo: Repository<LegalDocumentChunk>,

    @InjectRepository(LegalSource)
    private readonly sourceRepo: Repository<LegalSource>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly storageService: StorageService,
    private readonly aiService: AiService,
  ) {}

  // ─── Create / Upload ────────────────────────────────────────────────────────

  /**
   * Upload a PDF, create the legal_documents row, and kick off the
   * async ingestion pipeline:
   *   1. StorageService.uploadBuffer() → file stored + file_url set
   *   2. SHA-256 content_hash computed (dedup guard)
   *   3. Duplicate-hash check — 409 if same file already exists
   *   4. legal_documents row created (embedding_status=PENDING)
   *   5. ai-backend ingest-legal-document job dispatched asynchronously
   *      (Phase E: extract + NFKC-normalize + chunk + embed all live in
   *      Python now — NestJS no longer chunks in-process)
   */
  async createWithUpload(
    dto: CreateLegalDocumentDto,
    file: UploadedFile,
    userId: string,
  ): Promise<LegalDocument> {
    // 1. Compute SHA-256 of the raw file bytes for dedup
    const contentHash = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    // 2. Reject duplicate uploads (same file content)
    const existing = await this.docRepo.findOne({ where: { content_hash: contentHash } });
    if (existing) {
      throw new ConflictException(
        `A legal document with the same content already exists (id: ${existing.id}, title: "${existing.title}").`,
      );
    }

    // 2b. Resolve the legal source (carries the is_visual_order flag).
    //     400 if the source_id does not exist — we never ingest without a
    //     known direction, since unconditional reversal corrupts logical text.
    const source = await this.sourceRepo.findOne({ where: { id: dto.source_id } });
    if (!source) {
      throw new BadRequestException(
        `Legal source ${dto.source_id} not found. Catalogue the source first.`,
      );
    }

    // 3. Upload file to storage
    const uploaded = await this.storageService.uploadBuffer(
      file.buffer,
      'legal-documents',
      `${contentHash}.pdf`,
      file.mimetype,
    );

    // 4. Create the DB row
    const doc = this.docRepo.create({
      jurisdiction: dto.jurisdiction,
      source_type: dto.source_type,
      title: dto.title,
      law_number: dto.law_number ?? null,
      law_year: dto.law_year ?? null,
      gregorian_date: dto.gregorian_date ?? null,
      hijri_date: dto.hijri_date ?? null,
      status: dto.status ?? LegalDocumentStatus.IN_FORCE,
      language: dto.language ?? null,
      parent_law_id: dto.parent_law_id ?? null,
      file_url: uploaded.file_url,
      file_name: file.originalname,
      content_hash: contentHash,
      source_url: dto.source_url ?? null,
      source_attribution: dto.source_attribution ?? null,
      source_id: source.id,
      embedding_status: LegalDocumentEmbeddingStatus.PENDING,
      created_by: userId,
    });

    const saved = await this.docRepo.save(doc);
    this.logger.log(
      `Legal document created: ${saved.id} — "${saved.title}" ` +
        `(source: "${source.name}", is_visual_order=${source.is_visual_order}, ` +
        `force_ocr=${source.force_ocr})`,
    );

    // 5. Dispatch the full Python ingestion pipeline (non-blocking).
    //    One ai-backend Celery task does extract → NFKC-normalize → chunk →
    //    embed → bulk-update vectors, and writes embedding_status directly.
    //    The source flags decide extraction strategy: force_ocr selects the
    //    OCR path; is_visual_order decides word-order reversal (suppressed by
    //    OCR, which is logical-order natively — enforced ai-backend-side).
    this.dispatchIngestion(
      saved.id,
      source.is_visual_order,
      source.force_ocr,
    ).catch((err) =>
      this.logger.error(
        `[createWithUpload] Ingestion dispatch failed for doc ${saved.id}: ${err.message}`,
        err.stack,
      ),
    );

    return saved;
  }

  // ─── Ingestion Pipeline (Phase E — fully delegated to ai-backend) ────────────

  /**
   * Dispatch the single ai-backend ingestion task and record its job id.
   * The Python task owns the entire pipeline and updates embedding_status
   * (PENDING → PROCESSING → INDEXED/FAILED) directly in the DB.
   *
   * On dispatch failure we mark the document FAILED so it is never stuck
   * in PENDING with no job behind it.
   */
  private async dispatchIngestion(
    docId: string,
    isVisualOrder = false,
    forceOcr = false,
  ): Promise<void> {
    try {
      const result = await this.aiService.triggerIngestLegalDocument(
        docId,
        isVisualOrder,
        forceOcr,
      );
      await this.docRepo.update(docId, { embedding_job_id: result.job_id });
      this.logger.log(
        `[dispatchIngestion] Ingestion dispatched for doc ${docId}: job ${result.job_id}`,
      );
    } catch (err) {
      this.logger.error(
        `[dispatchIngestion] Failed to dispatch ingestion for doc ${docId}: ${err.message}`,
      );
      await this.docRepo.update(docId, {
        error_message: `Ingestion dispatch failed: ${err.message}`,
        embedding_status: LegalDocumentEmbeddingStatus.FAILED,
      });
    }
  }

  /**
   * Poll the embedding job status and update the document's embedding_status.
   * Called by the GET /:id endpoint so the admin can see progress.
   */
  async pollEmbeddingStatus(doc: LegalDocument): Promise<LegalDocument> {
    if (!doc.embedding_job_id) return doc;

    let jobStatus: Record<string, any>;
    try {
      jobStatus = await this.aiService.getJobStatus(doc.embedding_job_id);
    } catch {
      return doc;
    }

    if (jobStatus.status === 'completed') {
      await this.docRepo.update(doc.id, {
        embedding_status: LegalDocumentEmbeddingStatus.INDEXED,
        embedding_job_id: null,
      });
      return this.findById(doc.id);
    }

    if (jobStatus.status === 'failed') {
      await this.docRepo.update(doc.id, {
        embedding_status: LegalDocumentEmbeddingStatus.FAILED,
        error_message: jobStatus.error || 'Embedding failed',
        embedding_job_id: null,
      });
      return this.findById(doc.id);
    }

    return doc;
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  async findAll(dto: ListLegalDocumentsDto): Promise<{ data: LegalDocument[]; total: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.docRepo.createQueryBuilder('doc');

    if (dto.jurisdiction) {
      qb.andWhere('doc.jurisdiction = :jurisdiction', { jurisdiction: dto.jurisdiction });
    }
    if (dto.status) {
      qb.andWhere('doc.status = :status', { status: dto.status });
    }
    if (dto.search) {
      qb.andWhere('doc.title ILIKE :search', { search: `%${dto.search.replace(/[%_\\]/g, '\\$&')}%` });
    }

    qb.orderBy('doc.created_at', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findById(id: string): Promise<LegalDocument> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Legal document ${id} not found`);
    return doc;
  }

  /** Returns a document with its chunk count. */
  async findByIdWithChunkCount(id: string): Promise<LegalDocument & { chunk_count: number }> {
    const doc = await this.findById(id);
    // Advance embedding status if a job is in flight
    const updated = doc.embedding_job_id
      ? await this.pollEmbeddingStatus(doc)
      : doc;
    const chunkCount = await this.chunkRepo.count({ where: { legal_document_id: id } });
    return { ...updated, chunk_count: chunkCount };
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    // Delete file from storage (best-effort)
    if (doc.file_url) {
      await this.storageService.deleteFile(doc.file_url).catch((err) =>
        this.logger.warn(`[remove] Could not delete file for doc ${id}: ${err.message}`),
      );
    }
    await this.docRepo.delete(id);
    this.logger.log(`Legal document deleted: ${id}`);
  }

  // ─── Retrieval ──────────────────────────────────────────────────────────────

  /**
   * Retrieve the top-K most semantically relevant chunks for a query,
   * filtered by jurisdiction and excluding REPEALED laws.
   *
   * Flow:
   *   1. Embed the query text (synchronous ai-backend /agents/embed-query)
   *   2. Run pgvector cosine similarity search via raw parameterized SQL
   *   3. Return ranked chunks with parent document metadata
   *
   * The query is index-type-agnostic — the `<=>` operator works identically
   * with HNSW and IVFFlat. Switching index types requires only Migration B,
   * not this code.
   *
   * @param queryText   The user query / AI prompt excerpt to embed.
   * @param jurisdiction  e.g. 'EG'
   * @param topK        Number of chunks to return (default 5).
   */
  async retrieveRelevantChunks(
    queryText: string,
    jurisdiction: string,
    topK: number = 5,
  ): Promise<LegalChunkResult[]> {
    if (!queryText?.trim()) return [];

    // 1. Embed the query via a lightweight synchronous ai-backend endpoint
    let queryVector: number[];
    try {
      queryVector = await this.aiService.embedQuery(queryText);
    } catch (err) {
      this.logger.error(
        `[retrieveRelevantChunks] Embedding query failed: ${err.message}`,
        err.stack,
      );
      return [];
    }

    if (!queryVector || queryVector.length !== 1536) {
      this.logger.error(
        `[retrieveRelevantChunks] Unexpected embedding dimension: ${queryVector?.length}`,
      );
      return [];
    }

    // 2. Build the vector string for parameterized binding.
    // pgvector accepts '[0.1,0.2,...]' as a text parameter that PostgreSQL
    // implicitly casts to vector when combined with `::vector`.
    // This is parameterized (not string concat) — the vector elements are
    // fixed-precision floats from the OpenAI API, never user-supplied strings.
    const vectorStr = `[${queryVector.join(',')}]`;

    // 3. Run the vector similarity search.
    // Parameters: $1 = vector string, $2 = jurisdiction, $3 = top-K limit.
    // $1 is cast to ::vector so PostgreSQL uses the HNSW index.
    // The `<=>` cosine distance operator is index-type-agnostic per Q1 decision.
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `
      SELECT
        c.id,
        c.chunk_text,
        c.article_reference,
        c.legal_document_id,
        d.title,
        d.law_number,
        d.law_year,
        d.jurisdiction,
        (c.embedding <=> $1::vector) AS distance
      FROM legal_document_chunks c
      JOIN legal_documents d ON d.id = c.legal_document_id
      WHERE c.jurisdiction = $2
        AND c.embedding IS NOT NULL
        AND d.status != $3
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4
      `,
      [vectorStr, jurisdiction, LegalDocumentStatus.REPEALED, topK],
    );

    return rows.map((r) => ({
      chunk_id: r.id,
      chunk_text: r.chunk_text,
      article_reference: r.article_reference,
      legal_document_id: r.legal_document_id,
      document_title: r.title,
      law_number: r.law_number,
      law_year: r.law_year,
      jurisdiction: r.jurisdiction,
      distance: parseFloat(r.distance),
    }));
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LegalChunkResult {
  chunk_id: string;
  chunk_text: string;
  article_reference: string | null;
  legal_document_id: string;
  document_title: string;
  law_number: string | null;
  law_year: number | null;
  jurisdiction: string;
  /** Cosine distance (0 = identical, 1 = orthogonal, 2 = opposite). */
  distance: number;
}
