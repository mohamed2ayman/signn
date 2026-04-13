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
      'http://localhost:8000',
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
}
