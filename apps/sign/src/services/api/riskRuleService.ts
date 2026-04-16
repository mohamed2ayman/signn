import api from './axios';

export type RiskRuleSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskRule {
  id: string;
  name: string;
  description: string | null;
  risk_category: string;
  severity: RiskRuleSeverity;
  detection_keywords: string[] | null;
  applicable_contract_types: string[] | null;
  recommendation_template: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface CreateRiskRulePayload {
  name: string;
  description?: string;
  risk_category: string;
  severity: RiskRuleSeverity;
  detection_keywords?: string[];
  applicable_contract_types?: string[];
  recommendation_template?: string;
}

export const riskRuleService = {
  getAll: (activeOnly = false) =>
    api.get<RiskRule[]>('/risk-analysis/rules', { params: { active_only: activeOnly } }).then(r => r.data),

  create: (data: CreateRiskRulePayload) =>
    api.post<RiskRule>('/risk-analysis/rules', data).then(r => r.data),

  update: (id: string, data: Partial<CreateRiskRulePayload> & { is_active?: boolean }) =>
    api.put<RiskRule>(`/risk-analysis/rules/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/risk-analysis/rules/${id}`).then(r => r.data),
};
