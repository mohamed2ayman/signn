import api from './axios';
import { Clause } from '@/types';

export const clauseService = {
  getAll: (params?: { clause_type?: string; search?: string; is_active?: boolean }) =>
    api.get<Clause[]>('/clauses', { params }).then(r => r.data),

  getById: (id: string) =>
    api.get<Clause>(`/clauses/${id}`).then(r => r.data),

  create: (data: { title: string; content: string; clause_type?: string }) =>
    api.post<Clause>('/clauses', data).then(r => r.data),

  update: (id: string, data: { title?: string; content?: string; clause_type?: string; is_active?: boolean }) =>
    api.put<Clause>(`/clauses/${id}`, data).then(r => r.data),

  createNewVersion: (id: string, data: { title: string; content: string; clause_type?: string }) =>
    api.post<Clause>(`/clauses/${id}/new-version`, data).then(r => r.data),

  getVersionHistory: (id: string) =>
    api.get<Clause[]>(`/clauses/${id}/versions`).then(r => r.data),

  getClauseTypes: () =>
    api.get<string[]>('/clauses/types').then(r => r.data),

  delete: (id: string) =>
    api.delete(`/clauses/${id}`).then(r => r.data),
};
