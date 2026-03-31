import api from './axios';
import { RiskAnalysis, RiskRule, RiskCategory } from '@/types';

export const riskAnalysisService = {
  getByContract: (contractId: string) =>
    api.get<RiskAnalysis[]>(`/risk-analysis/contract/${contractId}`).then(r => r.data),

  getRiskSummary: (contractId: string) =>
    api.get<{ total: number; by_level: Record<string, number>; by_status: Record<string, number>; by_category: Record<string, number> }>(`/risk-analysis/contract/${contractId}/summary`).then(r => r.data),

  getByClause: (clauseId: string) =>
    api.get<RiskAnalysis[]>(`/risk-analysis/clause/${clauseId}`).then(r => r.data),

  updateStatus: (id: string, status: string) =>
    api.put<RiskAnalysis>(`/risk-analysis/${id}/status`, { status }).then(r => r.data),

  // Rules
  getRules: (activeOnly?: boolean) =>
    api.get<RiskRule[]>('/risk-analysis/rules', { params: { active_only: activeOnly } }).then(r => r.data),

  createRule: (data: Partial<RiskRule>) =>
    api.post<RiskRule>('/risk-analysis/rules', data).then(r => r.data),

  updateRule: (id: string, data: Partial<RiskRule>) =>
    api.put<RiskRule>(`/risk-analysis/rules/${id}`, data).then(r => r.data),

  deleteRule: (id: string) =>
    api.delete(`/risk-analysis/rules/${id}`).then(r => r.data),

  // Categories
  getCategories: () =>
    api.get<RiskCategory[]>('/risk-analysis/categories').then(r => r.data),
};
