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
};
