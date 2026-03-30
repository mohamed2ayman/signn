import api from './axios';
import { KnowledgeAsset } from '@/types';

export const knowledgeAssetService = {
  getAll: (params?: { asset_type?: string; review_status?: string; search?: string }) =>
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
};
