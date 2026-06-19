/**
 * Security event types — written to `audit_logs.action` for any
 * security-grade event, alongside the existing free-form actions used
 * by the rest of the platform.
 *
 * Stored as strings (audit_logs.action is varchar(255)) so this enum can
 * grow without a schema migration. The backend writes via
 * SecurityEventService; the admin frontend filters/colors on these
 * constants.
 */
export const SECURITY_EVENT_TYPES = {
  LOGIN_SUCCESS: 'security.login_success',
  LOGIN_FAILED: 'security.login_failed',
  LOGOUT: 'security.logout',
  MFA_ENABLED: 'security.mfa_enabled',
  MFA_DISABLED: 'security.mfa_disabled',
  MFA_RESET: 'security.mfa_reset',
  PASSWORD_CHANGED: 'security.password_changed',
  PASSWORD_RESET: 'security.password_reset',
  SESSION_REVOKED: 'security.session_revoked',
  SESSION_EXPIRED: 'security.session_expired',
  ACCOUNT_LOCKED: 'security.account_locked',
  ACCOUNT_UNLOCKED: 'security.account_unlocked',
  IP_BLOCKED: 'security.ip_blocked',
  SETTINGS_CHANGED: 'security.settings_changed',
  ADMIN_ACTION: 'security.admin_action',
  SUSPICIOUS_LOGIN: 'security.suspicious_login',
  GDPR_EXPORT: 'security.gdpr_export',
  GDPR_DELETE: 'security.gdpr_delete',
  /**
   * Phase 4.2 — a previously rotated refresh token was replayed.
   * Either the user's token store was compromised or the original token
   * was leaked. The entire token family is revoked atomically.
   */
  REFRESH_TOKEN_REUSE_DETECTED: 'security.refresh_token_reuse_detected',
  /**
   * Phase 7.17 Prompt 2c — portfolio export PDF download events.
   *
   * The download endpoint is bare HTTP + token (no global JWT guard
   * behind it — verified at plan review §3 #11). Every outcome writes
   * an audit row so leaked-URL probes and successful downloads are both
   * visible in admin/security for forensics. The HTTP response is
   * deliberately generic for failures (all 410 or 401, no per-reason
   * leak to the attacker); the audit log captures the actual reason.
   */
  PORTFOLIO_EXPORT_DOWNLOAD_SUCCESS: 'security.portfolio_export.download.success',
  PORTFOLIO_EXPORT_DOWNLOAD_EXPIRED: 'security.portfolio_export.download.expired',
  PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND: 'security.portfolio_export.download.not_found',
  PORTFOLIO_EXPORT_DOWNLOAD_INVALID_SIGNATURE: 'security.portfolio_export.download.invalid_signature',
  PORTFOLIO_EXPORT_DOWNLOAD_MALFORMED: 'security.portfolio_export.download.malformed',
  /**
   * Phase 7.28 v1.1 — operator/system ERP connection control. Written to
   * audit_logs.action with entity_type='erp_connection'. The `erp.` prefix is
   * registered in AdminActivityLogService so these surface in the admin feed.
   * `auto_suspended` carries actor_id = null (actor = SYSTEM / circuit-breaker).
   */
  ERP_CONNECTION_SUSPENDED: 'erp.connection.suspended',
  ERP_CONNECTION_UNSUSPENDED: 'erp.connection.unsuspended',
  ERP_CONNECTION_FORCE_CHECK: 'erp.connection.force_check',
  ERP_CONNECTION_DELETED: 'erp.connection.deleted',
  ERP_CONNECTION_AUTO_SUSPENDED: 'erp.connection.auto_suspended',
} as const;

export type SecurityEventType =
  (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];

/** All possible security event types as a readonly array — used for filter UIs. */
export const ALL_SECURITY_EVENT_TYPES: SecurityEventType[] =
  Object.values(SECURITY_EVENT_TYPES);
