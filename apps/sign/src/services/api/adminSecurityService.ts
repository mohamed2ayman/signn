import api from './axios';

// ─── Types ────────────────────────────────────────────────

export interface SecurityPolicy {
  id: 'global';
  session_timeout_minutes: number;
  password_min_length: number;
  password_require_upper: boolean;
  password_require_lower: boolean;
  password_require_number: boolean;
  password_require_symbol: boolean;
  password_expiry_days: number | null;
  password_history_count: number;
  lockout_max_attempts: number;
  lockout_duration_minutes: number;
  mfa_required_admins?: boolean;
  mfa_required_owners?: boolean;
  mfa_required_all?: boolean;
  ip_filter_enabled: boolean;
  ip_allowlist: string[] | null;
  ip_blocklist: string[] | null;
  updated_by: string | null;
  updated_at: string;
}

export interface SecurityScoreComponent {
  key: string;
  label: string;
  weight: number;
  score: number;
  detail: string;
  recommendation?: string;
}

export interface SecurityScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: SecurityScoreComponent[];
  computed_at: string;
}

export interface UserSession {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device_type: 'DESKTOP' | 'MOBILE' | 'TABLET' | 'UNKNOWN';
  location: string | null;
  country_code: string | null;
  is_suspicious: boolean;
  suspicious_reason: 'NEW_COUNTRY' | 'IMPOSSIBLE_TRAVEL' | 'BRUTE_FORCE' | null;
  last_active_at: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  user?: { email: string; first_name: string; last_name: string };
}

export interface BlockedIpAttempt {
  id: string;
  ip_address: string;
  reason: 'BLOCKLIST' | 'NOT_IN_ALLOWLIST';
  user_agent: string | null;
  attempted_email: string | null;
  created_at: string;
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  actor: { id: string; email: string; first_name?: string | null; last_name?: string | null } | null;
  target_user_id?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Calls ────────────────────────────────────────────────

const adminSecurityService = {
  // policy
  getPolicy: () => api.get<SecurityPolicy>('/admin/security/policy').then((r) => r.data),
  updatePolicy: (patch: Partial<SecurityPolicy>) =>
    api.patch<SecurityPolicy>('/admin/security/policy', patch).then((r) => r.data),

  // score + monitoring
  getScore: () => api.get<SecurityScore>('/admin/security/score').then((r) => r.data),
  listBlocked: (limit = 20) =>
    api.get<BlockedIpAttempt[]>('/admin/security/blocked-ips', { params: { limit } }).then((r) => r.data),
  listSuspicious: () =>
    api.get<{ count: number; sessions: UserSession[] }>('/admin/security/sessions/active-suspicious').then((r) => r.data),

  // audit feeds
  listAudit: (params: Record<string, unknown> = {}) =>
    api.get<AuditPage>('/admin/security/audit', { params }).then((r) => r.data),
  listActivity: (params: Record<string, unknown> = {}) =>
    api.get<AuditPage>('/admin/security/activity', { params }).then((r) => r.data),
  listKnownActions: () =>
    api.get<string[]>('/admin/security/activity/actions').then((r) => r.data),

  // per-user
  resetMfa: (userId: string) =>
    api.post<{ recovery_codes: string[]; sessions_revoked: number }>(`/admin/users/${userId}/mfa/reset`).then((r) => r.data),
  remindMfa: (userId: string) =>
    api.post<{ sent: boolean }>(`/admin/users/${userId}/mfa/remind`).then((r) => r.data),
  listUserSessions: (userId: string) =>
    api.get<UserSession[]>(`/admin/users/${userId}/sessions`).then((r) => r.data),
  revokeUserSession: (userId: string, sessionId: string) =>
    api.delete(`/admin/users/${userId}/sessions/${sessionId}`).then((r) => r.data),
  revokeAllUserSessions: (userId: string) =>
    api.delete<{ revoked: number }>(`/admin/users/${userId}/sessions`).then((r) => r.data),
  clearUserDevices: (userId: string) =>
    api.delete<{ cleared: number }>(`/admin/users/${userId}/devices`).then((r) => r.data),
  exportUserData: (userId: string) =>
    api.post<{ download_url: string; expires_at: string }>(`/admin/users/${userId}/gdpr/export`).then((r) => r.data),
  anonymizeUser: (userId: string, confirmation: string) =>
    api.post(`/admin/users/${userId}/gdpr/delete`, { confirmation }).then((r) => r.data),
};

export default adminSecurityService;
