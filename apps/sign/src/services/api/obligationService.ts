import api from './axios';
import { Obligation } from '@/types';
import type {
  ObligationStatus,
  ObligationType,
  ContractObligation,
} from './complianceService';

// ─── Types — added in Phase 7.1 Step 2 ────────────────────────

/**
 * One row from the project-wide or portfolio-wide obligation lists.
 * Backend enriches ContractObligation with project + assignee metadata.
 *
 * NOTE: project + assignees fields are OPTIONAL because the legacy
 * `/obligations/*` reads do not include them — only the new
 * `/obligations/portfolio` endpoint does.
 */
export interface ObligationPortfolioItem extends ContractObligation {
  project?: { id: string; name: string } | null;
  assignees?: ObligationAssignee[];
}

/**
 * Assignee membership row. Created by Phase 7.1 Step 1 backend.
 * One per (obligation_id, user_id) — DB UNIQUE constraint.
 */
export interface ObligationAssignee {
  id: string;
  obligation_id: string;
  user_id: string;
  assigned_at: string;
  assigned_by: string | null;
  user?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  };
}

/**
 * Calendar event shape returned by `/obligations/calendar`.
 * Aligned with FullCalendar / Big Calendar event interfaces so a
 * future calendar view (Step 3) can pass this through unchanged.
 */
export interface ObligationCalendarEvent {
  id: string;
  title: string;
  start: string; // ISO date
  end: string; // ISO date
  status: ObligationStatus;
  contract_id: string;
  project_id: string | null;
  color: string; // pre-computed by backend per status
}

/** Filters accepted by `/obligations/portfolio`. All optional. */
export interface PortfolioObligationFilters {
  from?: string; // ISO date
  to?: string; // ISO date
  /** Convenience window (days) — added in Phase 7.17 Prompt 2a. Server
   *  translates to from=today, to=today+within. Explicit from/to win if both
   *  are supplied. Used by the dashboard's "upcoming obligations (14d)" panel. */
  within?: number;
  project_id?: string;
  status?: ObligationStatus;
  type?: ObligationType;
  assignee?: string; // user_id
}

// ─── Service ──────────────────────────────────────────────────

export const obligationService = {
  // ── Existing methods (pre-Phase-7.1) — unchanged ────────────

  getByContract: (contractId: string) =>
    api
      .get<Obligation[]>(`/obligations/contract/${contractId}`)
      .then((r) => r.data),

  getById: (id: string) =>
    api.get<Obligation>(`/obligations/${id}`).then((r) => r.data),

  create: (data: {
    contract_id: string;
    contract_clause_id?: string;
    description: string;
    responsible_party?: string;
    due_date?: string;
    frequency?: string;
    reminder_days_before?: number;
  }) => api.post<Obligation>('/obligations', data).then((r) => r.data),

  update: (id: string, data: Partial<Obligation>) =>
    api.put<Obligation>(`/obligations/${id}`, data).then((r) => r.data),

  complete: (id: string, evidenceUrl?: string) =>
    api
      .put<Obligation>(`/obligations/${id}/complete`, {
        evidence_url: evidenceUrl,
      })
      .then((r) => r.data),

  getUpcoming: (days?: number) =>
    api
      .get<Obligation[]>('/obligations/upcoming', { params: { days } })
      .then((r) => r.data),

  getOverdue: () =>
    api.get<Obligation[]>('/obligations/overdue').then((r) => r.data),

  getDashboard: (contractId?: string) =>
    api
      .get<{
        total: number;
        by_status: Record<string, number>;
        overdue_count: number;
        upcoming_7_days: number;
      }>('/obligations/dashboard', { params: { contract_id: contractId } })
      .then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/obligations/${id}`).then((r) => r.data),

  // ── New methods (Phase 7.1 Step 2) ──────────────────────────

  /**
   * Cross-contract portfolio view. Returns enriched obligations spanning
   * every project in the user's organisation, optionally filtered.
   *
   * Backed by `GET /obligations/portfolio` (Phase 7.1 Step 1, Ayman PR).
   */
  getPortfolioObligations: (filters?: PortfolioObligationFilters) =>
    api
      .get<ObligationPortfolioItem[]>('/obligations/portfolio', {
        params: filters,
      })
      .then((r) => r.data),

  /**
   * Calendar events for a date range — used by the calendar view shipped
   * in Step 3. Backend pre-computes the colour per status.
   *
   * Backend hard-caps the range at 1 year per Step 1 documentation —
   * callers are responsible for respecting that.
   */
  getCalendarObligations: (from: string, to: string) =>
    api
      .get<ObligationCalendarEvent[]>('/obligations/calendar', {
        params: { from, to },
      })
      .then((r) => r.data),
};

// Re-export the existing complianceService types so callers only have
// to import from one place when working with portfolio data.
export type { ObligationStatus, ObligationType, ContractObligation };
