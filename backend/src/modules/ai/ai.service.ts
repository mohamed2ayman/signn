import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiBackendUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiBackendUrl = this.configService.get<string>(
      'AI_BACKEND_URL',
      'http://ai-backend:8000',
    );
  }

  // ─── Risk Analysis ─────────────────────────────────────────

  async triggerRiskAnalysis(data: {
    contract_id: string;
    clauses: Array<{
      id: string;
      text: string;
      document_id?: string | null;
      document_label?: string | null;
      document_priority?: number;
    }>;
    org_id: string;
    knowledge_context?: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/risk-analysis`, data),
    );
    this.logger.log(`Risk analysis dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Summarize ─────────────────────────────────────────────

  async triggerSummarize(data: {
    contract_id: string;
    full_text: string;
    org_id: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/summarize`, data),
    );
    this.logger.log(`Summarization dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Diff Analysis ─────────────────────────────────────────

  async triggerDiffAnalysis(data: {
    original_clauses: Array<{ id: string; text: string }>;
    modified_clauses: Array<{ id: string; text: string }>;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/diff`, data),
    );
    this.logger.log(`Diff analysis dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Obligations Extraction ────────────────────────────────

  async triggerExtractObligations(data: {
    contract_id: string;
    clauses: Array<{
      id: string;
      text: string;
      document_id?: string | null;
      document_label?: string | null;
      document_priority?: number;
    }>;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/extract-obligations`, data),
    );
    this.logger.log(`Obligations extraction dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Conflict Detection ────────────────────────────────────

  async triggerConflictDetection(data: {
    contract_id: string;
    clauses: Array<{
      id: string;
      text: string;
      document_id?: string | null;
      document_label?: string | null;
      document_priority?: number;
    }>;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/detect-conflicts`, data),
    );
    this.logger.log(`Conflict detection dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Chat ──────────────────────────────────────────────────

  async triggerChat(data: {
    message: string;
    contract_id?: string;
    org_id?: string;
    history?: Array<{ role: string; content: string }>;
    system_context?: string;
    knowledge_context?: string;
    /**
     * Guest chat Slice 1 — server-assembled contract grounding (metadata +
     * active clauses). The conversational agent already accepts it; the
     * ChatRequest pydantic field was added in the same slice (it was
     * previously absent, so the HTTP boundary silently dropped it).
     */
    contract_context?: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/chat`, data),
    );
    return response.data;
  }

  // ─── Research ──────────────────────────────────────────────

  async triggerResearch(data: {
    keywords: string[];
    jurisdiction?: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/research`, data),
    );
    return response.data;
  }

  // ─── Text Extraction ──────────────────────────────────────

  async triggerExtractText(data: {
    file_path: string;
    mime_type: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/extract-text`, data),
    );
    this.logger.log(`Text extraction dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Clause Extraction ───────────────────────────────────

  async triggerExtractClauses(data: {
    contract_id: string;
    full_text: string;
    contract_type?: string;
    document_label?: string;
    org_id: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/extract-clauses`, data),
    );
    this.logger.log(`Clause extraction dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Compliance Check (Phase 3.4) ──────────────────────────

  async triggerComplianceCheck(data: {
    contract_id: string;
    contract_type?: string | null;
    jurisdiction?: string | null;
    clauses: Array<{
      id: string;
      text: string;
      clause_ref?: string | null;
      document_label?: string | null;
    }>;
    standard_knowledge?: string | null;
    jurisdiction_knowledge?: string | null;
    playbook_knowledge?: string | null;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/compliance-check`, data),
    );
    this.logger.log(`Compliance check dispatched: job_id=${response.data.job_id}`);
    return response.data;
  }

  // ─── Job Status ────────────────────────────────────────────

  async getJobStatus(jobId: string): Promise<Record<string, any>> {
    const response = await firstValueFrom(
      this.httpService.get(`${this.aiBackendUrl}/agents/jobs/${jobId}`),
    );
    return response.data;
  }

  // ─── Embeddings ────────────────────────────────────────────

  async ingestEmbedding(data: {
    asset_id: string;
    text: string;
    org_id: string;
    metadata?: Record<string, any>;
  }): Promise<{ status: string; asset_id: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/embeddings/ingest`, data),
    );
    return response.data;
  }

  async searchEmbeddings(data: {
    query: string;
    org_id: string;
    filters?: Record<string, any>;
    top_k?: number;
  }): Promise<{ results: any[] }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/embeddings/search`, data),
    );
    return response.data;
  }

  // ─── Legal Corpus — Phase 7.27 ────────────────────────────

  /**
   * Dispatch the FULL legal-document ingestion pipeline to ai-backend
   * (Phase E refactor). One Celery task does extract → NFKC-normalize →
   * chunk (tiktoken-capped) → bulk-insert → embed → bulk-update vectors.
   *
   * This replaces the old multi-step flow (triggerExtractText →
   * triggerEmbedLegalChunks) that chunked in TypeScript. Returns
   * { job_id, status } immediately; the document's embedding_status
   * column reflects progress (PENDING → PROCESSING → INDEXED/FAILED).
   */
  async triggerIngestLegalDocument(
    documentId: string,
    isVisualOrder = false,
    forceOcr = false,
  ): Promise<{
    job_id: string;
    status: string;
  }> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiBackendUrl}/agents/ingest-legal-document`,
        {
          document_id: documentId,
          is_visual_order: isVisualOrder,
          force_ocr: forceOcr,
        },
      ),
    );
    this.logger.log(
      `Legal document ingestion dispatched: document_id=${documentId} ` +
        `is_visual_order=${isVisualOrder} force_ocr=${forceOcr} ` +
        `job_id=${response.data.job_id}`,
    );
    return response.data;
  }

  /**
   * @deprecated Phase E moved chunking into the single ingestion task
   * (triggerIngestLegalDocument). Retained in case another caller exists;
   * the legal-documents flow no longer uses this.
   *
   * Dispatch an async Celery job that embeds all PENDING chunks for a
   * legal document. The job writes vectors directly to PostgreSQL via
   * psycopg2 + pgvector.
   *
   * Returns { job_id, status } immediately; caller polls getJobStatus().
   */
  async triggerEmbedLegalChunks(data: {
    document_id: string;
  }): Promise<{ job_id: string; status: string }> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/embed-legal-chunks`, data),
    );
    this.logger.log(
      `Legal chunk embedding dispatched: document_id=${data.document_id} job_id=${response.data.job_id}`,
    );
    return response.data;
  }

  /**
   * Synchronous call — returns the OpenAI embedding vector for the given
   * text. Used by the retrieval path (retrieveRelevantChunks) to embed
   * the query text before the pgvector similarity search.
   *
   * Returns a number[] of length 1536 (text-embedding-3-small).
   */
  async embedQuery(text: string): Promise<number[]> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.aiBackendUrl}/agents/embed-query`, { text }),
    );
    return response.data.embedding as number[];
  }
}
