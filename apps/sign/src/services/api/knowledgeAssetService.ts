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
};
