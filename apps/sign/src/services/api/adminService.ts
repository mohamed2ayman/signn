import api from './axios';
import { User, KnowledgeAsset, SubscriptionPlan, UserRole, PermissionLevel } from '@/types';

// ─── System Health types ──────────────────────────────────────────────────────

export type ServiceStatus = 'up' | 'down' | 'skipped';
export type OverallStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface ServiceHealth {
  status: ServiceStatus;
  responseTime?: number;
}

export interface QueueHealth {
  status: ServiceStatus;
  waiting: number;
  active: number;
  failed: number;
}

// ─── Audit Log types ─────────────────────────────────────────────────────────

export interface AuditLogUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface AuditLogOrganization {
  id: string;
  name: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user: AuditLogUser | null;
  organization_id: string | null;
  organization: AuditLogOrganization | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  totalPages: number;
}

export interface AuditLogFilters {
  actions: string[];
  entityTypes: string[];
  organizations: { id: string; name: string }[];
}

export interface AuditLogQuery {
  organizationId?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface SystemHealthResponse {
  overall: OverallStatus;
  timestamp: string;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    emailQueue: QueueHealth;
    aiQueue: QueueHealth;
    aiBackend: ServiceHealth;
    s3: { status: ServiceStatus };
  };
}

export interface InviteUserRequest {
  email: string;
  role: UserRole;
  job_title?: string;
  default_permission_level?: PermissionLevel;
  project_ids?: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: string;
  is_active: boolean;
  mfa_enabled: boolean;
  mfa_method: 'email' | 'totp' | null;
  last_login_at: string | null;
  invitation_sent_at: string | null;
  /** Computed server-side: null means no invitation tracking for this user */
  invitation_status: 'ACCEPTED' | 'PENDING' | 'EXPIRED' | null;
  created_at: string;
}

export interface CreateOperationsUserRequest {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  jobTitle?: string;
  department?: string;
}

export const adminService = {
  // Users (org-scoped)
  getUsers: () =>
    api.get<User[]>('/users').then(r => r.data),

  inviteUser: (data: InviteUserRequest) =>
    api.post('/users/invite', data).then(r => r.data),

  updateUserRole: (userId: string, role: UserRole) =>
    api.put(`/users/${userId}/role`, { role }).then(r => r.data),

  deactivateUser: (userId: string) =>
    api.delete(`/users/${userId}`).then(r => r.data),

  // System admin: all users (optional role filter)
  getAllUsers: (role?: string) =>
    api.get<AdminUser[]>('/users/admin/all', { params: role ? { role } : undefined }).then(r => r.data),

  checkEmail: (email: string) =>
    api.get<{ exists: boolean }>('/users/check-email', { params: { email } }).then(r => r.data),

  createOperationsUser: (data: CreateOperationsUserRequest) =>
    api.post<AdminUser>('/users/admin/create-operations', data).then(r => r.data),

  resendInvitation: (userId: string) =>
    api.post<{ success: boolean; sentAt: string }>(`/users/${userId}/resend-invitation`).then(r => r.data),

  resetUserMfa: (userId: string) =>
    api.post<{ message: string }>(`/users/${userId}/mfa/reset`).then(r => r.data),

  // Knowledge Assets pending review
  getPendingAssets: () =>
    api.get<KnowledgeAsset[]>('/knowledge-assets/pending-review').then(r => r.data),

  // Subscription plans
  getPlans: () =>
    api.get<SubscriptionPlan[]>('/admin/subscription-plans/all').then(r => r.data),

  createPlan: (data: Partial<SubscriptionPlan>) =>
    api.post<SubscriptionPlan>('/admin/subscription-plans', data).then(r => r.data),

  updatePlan: (id: string, data: Partial<SubscriptionPlan>) =>
    api.put<SubscriptionPlan>(`/admin/subscription-plans/${id}`, data).then(r => r.data),

  // System health
  getSystemHealth: () =>
    api.get<SystemHealthResponse>('/admin/health').then(r => r.data),

  // Audit logs
  getAuditLogs: (query: AuditLogQuery) =>
    api.get<AuditLogListResponse>('/admin/audit-logs', { params: query }).then(r => r.data),

  getAuditLogFilters: () =>
    api.get<AuditLogFilters>('/admin/audit-logs/filters').then(r => r.data),

  exportAuditLogs: (query: Omit<AuditLogQuery, 'page' | 'limit'>) =>
    api.get<AuditLogEntry[]>('/admin/audit-logs/export', { params: query }).then(r => r.data),

  // ─── Operations Review Queue ─────────────────────────────────────────────

  getOperationsReviewStats: () =>
    api.get<OperationsReviewStats>('/admin/operations-review/stats').then(r => r.data),

  getOperationsReviewQueue: (params?: OperationsReviewQueueParams) =>
    api.get<OperationsReviewQueueResponse>('/admin/operations-review/queue', { params })
      .then(r => r.data),

  batchReviewAssets: (body: BatchReviewRequest) =>
    api.post<BatchReviewResponse>('/admin/operations-review/batch', body).then(r => r.data),

  getConfidenceThreshold: () =>
    api.get<{ threshold: number }>('/admin/operations-review/confidence-threshold')
      .then(r => r.data),

  setConfidenceThreshold: (threshold: number) =>
    api.put<{ threshold: number; updatedAt: string }>(
      '/admin/operations-review/confidence-threshold',
      { threshold },
    ).then(r => r.data),

  /**
   * Single-asset review — reuses the existing PUT /knowledge-assets/:id/review
   * endpoint (which accepts { review_status }).
   */
  approveAsset: (id: string) =>
    api.put(`/knowledge-assets/${id}/review`, { review_status: 'APPROVED' })
      .then(r => r.data),

  rejectAsset: (id: string, _reason?: string) =>
    api.put(`/knowledge-assets/${id}/review`, { review_status: 'REJECTED' })
      .then(r => r.data),

  // ─── System Analytics ────────────────────────────────────────────────
  getAnalytics: <T = AnalyticsResponse>(tab: AnalyticsTab, period: AnalyticsPeriod) =>
    api.get<T>('/admin/analytics', { params: { tab, period } }).then(r => r.data),

  // ─── Organization Management ──────────────────────────────────────────
  getOrganizations: (filters?: OrganizationFilters) =>
    api.get<AdminOrganizationListResponse>('/admin/organizations', { params: filters })
      .then(r => r.data),

  getOrganizationById: (id: string) =>
    api.get<AdminOrganizationDetail>(`/admin/organizations/${id}`).then(r => r.data),

  suspendOrganization: (id: string, reason: string) =>
    api.put<AdminOrganizationDetail>(`/admin/organizations/${id}/suspend`, { reason })
      .then(r => r.data),

  unsuspendOrganization: (id: string) =>
    api.put<AdminOrganizationDetail>(`/admin/organizations/${id}/unsuspend`)
      .then(r => r.data),

  updateFeatureFlags: (id: string, featureFlags: Record<string, boolean>) =>
    api.put<AdminOrganizationDetail>(`/admin/organizations/${id}/feature-flags`, { featureFlags })
      .then(r => r.data),

  // ─── Billing & Payments ──────────────────────────────────────────────
  getBillingSummary: () =>
    api.get<BillingSummary>('/admin/billing/summary').then(r => r.data),

  getTransactions: (params?: TransactionsQueryParams) =>
    api.get<PaymentTransactionListResponse>('/admin/billing/transactions', { params })
      .then(r => r.data),

  getFailedPayments: () =>
    api.get<FailedPayment[]>('/admin/billing/failed-payments').then(r => r.data),

  exportTransactions: async (params?: TransactionsQueryParams) => {
    const res = await api.get('/admin/billing/transactions/export', {
      params,
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sign-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// ─── System Analytics types ────────────────────────────────────────────────

export type AnalyticsTab =
  | 'overview'
  | 'subscriptions'
  | 'users'
  | 'contracts'
  | 'knowledge'
  | 'performance';

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '365d';

export interface OverviewAnalytics {
  totalRevenue: number;
  revenueChange: number;
  activeUsers: number;
  usersChange: number;
  totalContracts: number;
  contractsChange: number;
  systemUptime: number;
  topPerformingPlans: Array<{ name: string; subscribers: number; revenue: number }>;
  knowledgeAssetUsage: Array<{ title: string; category: string; uses: number }>;
  revenueTimeSeries: Array<{ date: string; value: number }>;
}

export interface SubscriptionsAnalytics {
  mrr: number;
  arr: number;
  mrrChange: number;
  planBreakdown: Array<{
    planName: string;
    subscribers: number;
    revenue: number;
    percentage: number;
  }>;
  churnRate: number;
  upgradeRate: number;
  annualVsMonthly: { annual: number; monthly: number };
  revenueTimeSeries: Array<{ date: string; value: number }>;
}

export interface UsersAnalytics {
  totalUsers: number;
  newUsersThisPeriod: number;
  byRole: Array<{ role: string; count: number; percentage: number }>;
  mfaAdoptionRate: number;
  invitationAcceptanceRate: number;
  newUserTimeSeries: Array<{ date: string; count: number }>;
}

export interface ContractsAnalytics {
  totalContracts: number;
  contractsThisPeriod: number;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  avgTimeToSign: number | null;
  docuSignAdoptionRate: number;
  contractTimeSeries: Array<{ date: string; count: number }>;
}

export interface KnowledgeAnalytics {
  totalAssets: number;
  pendingReview: number;
  byType: Array<{ type: string; count: number }>;
  byJurisdiction: Array<{ jurisdiction: string; count: number }>;
  indexingSuccessRate: number;
  topUsedAssets: Array<{ title: string; uses: number }>;
}

export interface PerformanceAnalytics {
  apiResponseTimeP95: number;
  errorRate: number;
  activeWebSocketSessions: number;
  bullQueueDepths: { emailQueue: number; aiQueue: number };
  storageUsedPercent: number;
  aiBackendLatency: number;
}

export type AnalyticsResponse =
  | OverviewAnalytics
  | SubscriptionsAnalytics
  | UsersAnalytics
  | ContractsAnalytics
  | KnowledgeAnalytics
  | PerformanceAnalytics;

// ─── Operations Review types ────────────────────────────────────────────────

export interface OperationsReviewStats {
  pendingCount: number;
  approvedToday: number;
  rejectedToday: number;
  aiAccuracyRate: number;
  totalReviewedAllTime: number;
}

export interface OperationsReviewAsset {
  id: string;
  title: string;
  asset_type: string;
  tags: string[];
  jurisdiction: string | null;
  confidence_score: number | null;
  created_at: string;
  file_url: string | null;
  embedding_status: string;
  ocr_status: string;
  detected_languages: string[] | null;
  include_in_risk_analysis: boolean;
  include_in_citations: boolean;
  source: string | null;
  page_count: number | null;
  language: string;
}

export interface OperationsReviewQueueParams {
  page?: number;
  limit?: number;
  minConfidence?: number;
  maxConfidence?: number;
  category?: string;
}

export interface OperationsReviewQueueResponse {
  data: OperationsReviewAsset[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BatchReviewRequest {
  assetIds: string[];
  action: 'APPROVE' | 'REJECT';
  reason?: string;
}

export interface BatchReviewResponse {
  processed: number;
  failed: number;
  errors?: string[];
}

// ─── Organization Management types ──────────────────────────────────────────

export type OrgStatusFilter = 'ACTIVE' | 'SUSPENDED';

export interface OrganizationFilters {
  page?: number;
  limit?: number;
  search?: string;
  country?: string;
  industry?: string;
  planId?: string;
  status?: OrgStatusFilter;
}

export interface AdminOrganizationPlanSummary {
  id: string;
  name: string;
  status: string;
  expiresAt: string | null;
}

export interface AdminOrganization {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  crn: string | null;
  logo_url: string | null;
  created_at: string;
  activeUserCount: number;
  projectCount: number;
  contractCount: number;
  currentPlan: AdminOrganizationPlanSummary | null;
  isSuspended: boolean;
  suspensionReason: string | null;
}

export interface AdminOrganizationListResponse {
  data: AdminOrganization[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminOrganizationDetailUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

export interface AdminOrganizationSubscriptionHistoryItem {
  id: string;
  planName: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

export interface AdminOrganizationCurrentPlan {
  id: string;
  name: string;
  status: string;
  price: number;
  currency: string;
  startDate: string;
  expiresAt: string | null;
}

export interface AdminOrganizationUsage {
  users: { used: number; max: number };
  projects: { used: number; max: number };
}

export interface AdminOrganizationRecentAuditLog {
  id: string;
  action: string;
  entityType: string | null;
  user: string | null;
  created_at: string;
}

export interface AdminOrganizationDetail {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  crn: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
  isSuspended: boolean;
  suspensionReason: string | null;
  suspendedAt: string | null;
  currentPlan: AdminOrganizationCurrentPlan | null;
  users: AdminOrganizationDetailUser[];
  subscriptionHistory: AdminOrganizationSubscriptionHistoryItem[];
  currentUsage: AdminOrganizationUsage;
  featureFlagOverrides: Record<string, boolean>;
  recentAuditLogs: AdminOrganizationRecentAuditLog[];
}

// ─── Billing & Payments types ──────────────────────────────────────────────

export type PaymentTransactionStatus = 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PENDING';

export interface PlanRevenueRow {
  planName: string;
  revenue: number;
  subscribers: number;
}

export interface CurrencyRevenueRow {
  currency: string;
  amount: number;
}

export interface BillingSummary {
  mrr: number;
  arr: number;
  mrrChange: number;
  activeSubscriptions: number;
  failedPaymentsCount: number;
  failedPaymentsAmount: number;
  newThisMonth: number;
  churnedThisMonth: number;
  revenueByPlan: PlanRevenueRow[];
  revenueByCurrency: CurrencyRevenueRow[];
}

export interface TransactionsQueryParams {
  page?: number;
  limit?: number;
  organizationId?: string;
  status?: PaymentTransactionStatus | string;
  currency?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaymentTransaction {
  id: string;
  organization_id: string;
  organizationName: string;
  paymob_transaction_id: string | null;
  amount: number;
  currency: string;
  status: PaymentTransactionStatus | string;
  plan_id: string | null;
  plan_name: string | null;
  created_at: string;
}

export interface PaymentTransactionListResponse {
  data: PaymentTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FailedPayment {
  organizationId: string;
  organizationName: string;
  contactEmail: string | null;
  failedAmount: number;
  currency: string;
  lastAttempt: string;
  failureCount: number;
}
