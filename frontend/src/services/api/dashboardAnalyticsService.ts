import api from './axios';

export interface DashboardAnalytics {
  projects: {
    total: number;
  };
  contracts: {
    total: number;
    by_status: Record<string, number>;
  };
  risks: {
    total: number;
    by_level: Record<string, number>;
    by_status: Record<string, number>;
    high_unresolved: number;
  };
  obligations: {
    total: number;
    overdue: number;
    due_this_week: number;
    due_this_month: number;
    completed: number;
    pending: number;
    by_status: Record<string, number>;
    completion_rate: number;
  };
  clauses: {
    total: number;
    ai_extracted: number;
    manually_created: number;
    pending_review: number;
    approved: number;
  };
  documents: {
    total: number;
    processed: number;
    total_pages: number;
  };
  loss_aversion: {
    total_hours_saved: number;
    hours_saved_extraction: number;
    hours_saved_clause_analysis: number;
    documents_processed: number;
    clauses_extracted: number;
    unaddressed_high_risks: number;
    overdue_obligations: number;
    obligations_due_this_week: number;
    clauses_pending_review: number;
    obligation_completion_rate: number;
  };
  recent_activity: {
    recent_documents: Array<{
      id: string;
      file_name: string;
      status: string;
      contract_name: string;
      updated_at: string;
    }>;
    recent_risks: Array<{
      id: string;
      risk_level: string;
      category: string;
      description: string;
      status: string;
      created_at: string;
    }>;
  };
  upcoming_obligations: Array<{
    id: string;
    description: string;
    due_date: string;
    status: string;
    responsible_party: string | null;
    contract_name: string;
    is_overdue: boolean;
    days_until_due: number | null;
  }>;
}

export const dashboardAnalyticsService = {
  getAnalytics: () =>
    api.get<DashboardAnalytics>('/dashboard-analytics').then((r) => r.data),
};
