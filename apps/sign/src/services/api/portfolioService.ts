import api from './axios';

// ─── Types — mirror the Phase 7.17 Prompt 2a endpoint contract ──────────────
// GET /portfolio-analytics (OWNER_ADMIN, org-scoped). See CLAUDE.md Phase 7.17
// Prompt 2a for the authoritative shape. period + project_id are the ONLY
// server-side filters; status/standard-form/currency arrive as whole breakdowns.

export type PortfolioPeriod = '7d' | '30d' | '90d' | '365d';

export interface PortfolioDelta {
  current: number;
  previous: number;
  delta_pct: number;
}

export interface PortfolioKpis {
  total_contracts: number;
  active_contracts: number;
  open_risks: number;
  contracts_created: PortfolioDelta;
  risks_flagged: PortfolioDelta;
}

export type ContractStatusBucket =
  | 'DRAFT'
  | 'IN_APPROVAL'
  | 'WITH_COUNTERPARTY'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'TERMINATED';

export interface ContractsByStatus {
  total: number;
  buckets: Record<ContractStatusBucket, number>;
}

export interface ValueByCurrency {
  currency: string;
  total: number;
  count: number;
}

export interface TimeToSignatureTrendPoint {
  month: string;
  avg_days: number | null;
  count: number;
}

export interface TimeToSignature {
  avg_days: number | null;
  sample_size: number;
  /** Signed contracts that had executed_at but no shared_at — excluded from the avg (surfaced, never silently dropped). */
  excluded_no_shared_at: number;
  trend: TimeToSignatureTrendPoint[];
}

export interface UpcomingExpirations {
  in_30_days: number;
  in_60_days: number;
  in_90_days: number;
  total_within_90: number;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ProjectRisk {
  project_id: string;
  project_name: string;
  worst_score: number;
  level: RiskLevel;
  finding_count: number;
}

export interface RiskDistribution {
  total: number;
  levels: Record<RiskLevel, number>;
}

export type StandardForm = 'FIDIC' | 'NEC' | 'OTHER' | 'ADHOC';

export interface ContractsByStandardForm {
  total: number;
  forms: Record<StandardForm, number>;
}

export interface TopProject {
  project_id: string;
  project_name: string;
  contract_count: number;
  active_count: number;
  worst_score: number | null;
  worst_level: RiskLevel | null;
}

export interface PortfolioAnalytics {
  period: PortfolioPeriod;
  project_id: string | null;
  kpis: PortfolioKpis;
  contracts_by_status: ContractsByStatus;
  value_by_currency: ValueByCurrency[];
  time_to_signature: TimeToSignature;
  upcoming_expirations: UpcomingExpirations;
  project_risk: ProjectRisk[];
  risk_distribution: RiskDistribution;
  contracts_by_standard_form: ContractsByStandardForm;
  top_projects: TopProject[];
}

/** Server-side filters ONLY (period + project). Nothing else is a server filter. */
export interface PortfolioFilters {
  period?: PortfolioPeriod;
  project_id?: string;
}

/** Response from POST /portfolio-exports (Phase 7.17 Prompt 2c Bucket 3). */
export interface PortfolioExportRequestResponse {
  job_id: string;
  email: string;
}

export const portfolioService = {
  getPortfolioAnalytics: (filters: PortfolioFilters = {}) =>
    api
      .get<PortfolioAnalytics>('/portfolio-analytics', { params: filters })
      .then((r) => r.data),

  /**
   * Phase 7.17 Prompt 2c Bucket 4 — request a portfolio PDF export.
   *
   * POST /portfolio-exports. JWT + OWNER_ADMIN + 5/15min throttler.
   * Returns { job_id, email } so the UI can show the destination
   * email in the success toast. The backend captures user.email at
   * request time — we don't send the email in the body (the body
   * carries ONLY period + project_id; scoping is JWT-derived).
   */
  requestExport: (period: PortfolioPeriod, projectId?: string) =>
    api
      .post<PortfolioExportRequestResponse>('/portfolio-exports', {
        period,
        ...(projectId ? { project_id: projectId } : {}),
      })
      .then((r) => r.data),
};
