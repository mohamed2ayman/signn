import api from './axios';
import { Obligation } from '@/types';

export const obligationService = {
  getByContract: (contractId: string) =>
    api.get<Obligation[]>(`/obligations/contract/${contractId}`).then(r => r.data),

  getById: (id: string) =>
    api.get<Obligation>(`/obligations/${id}`).then(r => r.data),

  create: (data: { contract_id: string; contract_clause_id?: string; description: string; responsible_party?: string; due_date?: string; frequency?: string; reminder_days_before?: number }) =>
    api.post<Obligation>('/obligations', data).then(r => r.data),

  update: (id: string, data: Partial<Obligation>) =>
    api.put<Obligation>(`/obligations/${id}`, data).then(r => r.data),

  complete: (id: string, evidenceUrl?: string) =>
    api.put<Obligation>(`/obligations/${id}/complete`, { evidence_url: evidenceUrl }).then(r => r.data),

  getUpcoming: (days?: number) =>
    api.get<Obligation[]>('/obligations/upcoming', { params: { days } }).then(r => r.data),

  getOverdue: () =>
    api.get<Obligation[]>('/obligations/overdue').then(r => r.data),

  getDashboard: (contractId?: string) =>
    api.get<{ total: number; by_status: Record<string, number>; overdue_count: number; upcoming_7_days: number }>('/obligations/dashboard', { params: { contract_id: contractId } }).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/obligations/${id}`).then(r => r.data),
};
