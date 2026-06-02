import api from './axios';
import { KnowledgeAsset } from '@/types';

export interface ProcessingStatus {
  ocrStatus: string;
  embeddingStatus: string;
  detectedLanguages: string[] | null;
  processingProgress: number;
  errorMessage?: string;
}

export interface DuplicateCheckResult {
  exists: boolean;
  assetId?: string;
  assetTitle?: string;
}

export const knowledgeAssetService = {
  getAll: (params?: {
    asset_type?: string;
    review_status?: string;
    embedding_status?: string;
    search?: string;
    /** Exact jurisdiction filter, e.g. 'EG', 'AE', 'UK' */
    jurisdiction?: string;
    /**
     * Comma-separated tag filter string sent as ?tags=tag1,tag2.
     * The backend requires the asset to contain ALL supplied tags.
     */
    tags?: string;
    /**
     * Phase 7.24e — optional project scope.
     * When supplied, project-scoped assets for this project are returned
     * alongside platform + org-wide assets.
     */
    project_id?: string;
  }) =>
    api.get<KnowledgeAsset[]>('/knowledge-assets', { params }).then(r => r.data),

  getById: (id: string) =>
    api.get<KnowledgeAsset>(`/knowledge-assets/${id}`).then(r => r.data),

  create: (data: FormData) =>
    api.post<KnowledgeAsset>('/knowledge-assets', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),

  update: (id: string, data: Partial<KnowledgeAsset>) =>
    api.put<KnowledgeAsset>(`/knowledge-assets/${id}`, data).then(r => r.data),

  review: (id: string, reviewStatus: string) =>
    api.put<KnowledgeAsset>(`/knowledge-assets/${id}/review`, { review_status: reviewStatus }).then(r => r.data),

  getPendingReview: () =>
    api.get<KnowledgeAsset[]>('/knowledge-assets/pending-review').then(r => r.data),

  delete: (id: string) =>
    api.delete(`/knowledge-assets/${id}`).then(r => r.data),

  /** Checks whether a file (identified by its SHA-256 hex hash) already exists. */
  checkDuplicate: (hash: string) =>
    api.post<DuplicateCheckResult>('/knowledge-assets/check-duplicate', { hash }).then(r => r.data),

  /** Polls the processing state of an asset. */
  getProcessingStatus: (id: string) =>
    api.get<ProcessingStatus>(`/knowledge-assets/${id}/processing-status`).then(r => r.data),

  /** Re-queues OCR + embedding for a failed asset. */
  retryOcr: (id: string) =>
    api.post<{ message: string }>(`/knowledge-assets/${id}/retry-ocr`).then(r => r.data),

  /** Returns the version list for an asset (Phase 7.24d). */
  getVersions: (id: string) =>
    api
      .get<
        Array<{
          id: string;
          version_number: number;
          changed_by: string | null;
          changer_name: string | null;
          change_summary: string | null;
          created_at: string;
        }>
      >(`/knowledge-assets/${id}/versions`)
      .then((r) => r.data),

  /** Returns the full snapshot for a specific version (Phase 7.24d). */
  getVersionSnapshot: (id: string, versionNumber: number) =>
    api
      .get<{ version_number: number; snapshot_data: Record<string, unknown>; created_at: string }>(
        `/knowledge-assets/${id}/versions/${versionNumber}`,
      )
      .then((r) => r.data),

  /**
   * Bulk import — up to 20 files with shared metadata (Phase 7.24c).
   * Partial-success: failing/duplicate files are reported without aborting the batch.
   */
  bulkCreate: (data: FormData) =>
    api
      .post<{
        created: Array<{ id: string; title: string; filename: string }>;
        duplicates: string[];
        failed: Array<{ filename: string; error: string }>;
      }>('/knowledge-assets/bulk', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),

  /** Returns "Used In" backlink rows for the asset (Phase 7.24b). */
  getUsages: (id: string) =>
    api
      .get<Array<{ context_type: string; context_id: string; used_at: string }>>(
        `/knowledge-assets/${id}/usages`,
      )
      .then(r => r.data),
};
