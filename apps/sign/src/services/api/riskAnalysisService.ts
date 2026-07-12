import api from './axios';
import { RiskAnalysis, RiskRule, RiskCategory } from '@/types';

export const riskAnalysisService = {
  getByContract: (contractId: string) =>
    api.get<RiskAnalysis[]>(`/risk-analysis/contract/${contractId}`).then(r => r.data),

  getRiskSummary: (contractId: string) =>
    api.get<{ total: number; by_level: Record<string, number>; by_status: Record<string, number>; by_category: Record<string, number> }>(`/risk-analysis/contract/${contractId}/summary`).then(r => r.data),

  getByClause: (clauseId: string) =>
    api.get<RiskAnalysis[]>(`/risk-analysis/clause/${clauseId}`).then(r => r.data),

  // Risk-tab clutter reduction — per-clause swap overrides + completeness.
  getVisibility: (contractId: string) =>
    api
      .get<Record<string, string[]>>(`/risk-analysis/contract/${contractId}/visibility`)
      .then(r => r.data),

  setVisibility: (contractClauseId: string, visibleRiskIds: string[]) =>
    api
      .put(`/risk-analysis/clause/${contractClauseId}/visibility`, {
        visible_risk_ids: visibleRiskIds,
      })
      .then(r => r.data),

  getCompleteness: (contractId: string) =>
    api
      .get<{
        complete: boolean;
        clauses: number;
        visible_total: number;
        visible_verified: number;
        visible_unverified: number;
        hidden_total: number;
        incomplete_clause_ids: string[];
      }>(`/risk-analysis/contract/${contractId}/completeness`)
      .then(r => r.data),

  updateStatus: (id: string, status: string) =>
    api.put<RiskAnalysis>(`/risk-analysis/${id}/status`, { status }).then(r => r.data),

  // Phase 8.3 / Risk-tab rework STEP 2 — editable Risk Analysis tab. Human
  // correction of a finding's level, category and/or recommendation text. Hits
  // the PATCH /risk-analysis/:id endpoint (snapshots the AI original once).
  annotate: (
    id: string,
    data: { risk_level?: string; risk_category?: string; recommendation?: string },
  ) => api.patch<RiskAnalysis>(`/risk-analysis/${id}`, data).then(r => r.data),

  // Risk-tab rework — STEP 3: AI clause re-phrase.
  // 1) dispatch the rewrite job for the risk's clause.
  startRephrase: (id: string) =>
    api
      .post<{ job_id: string; status: string }>(`/risk-analysis/${id}/rephrase`)
      .then(r => r.data),

  // 2) poll the job; on completion the backend creates the proposed clause and
  //    returns it (with the original) for the merge preview.
  pollRephrase: (id: string, jobId: string) =>
    api
      .get<{
        status: 'pending' | 'processing' | 'completed' | 'failed';
        error?: string;
        proposed?: {
          proposed_contract_clause_id: string;
          title: string;
          content: string;
          original_title: string;
          original_content: string;
        };
      }>(`/risk-analysis/${id}/rephrase/status`, { params: { job_id: jobId } })
      .then(r => r.data),

  // Option C (TASK 2) — persist an edit to the PENDING proposed clause text.
  editProposal: (id: string, data: { title?: string; content: string }) =>
    api
      .post<{
        proposed_contract_clause_id: string;
        title: string;
        content: string;
        original_title: string;
        original_content: string;
      }>(`/risk-analysis/${id}/rephrase/edit`, data)
      .then(r => r.data),

  // 3) accept (Merge & Apply — promote via parent-chain) or reject (Cancel).
  //    markHandled (TASK 3) defaults to true — the checkbox is checked.
  applyRephrase: (
    id: string,
    action: 'accept' | 'reject',
    markHandled = true,
  ) =>
    api
      .post<{ applied: boolean; action: 'accept' | 'reject' }>(
        `/risk-analysis/${id}/rephrase/apply`,
        { action, mark_handled: markHandled },
      )
      .then(r => r.data),

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
