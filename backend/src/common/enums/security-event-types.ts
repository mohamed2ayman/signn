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
} as const;

export type SecurityEventType =
  (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];

/** All possible security event types as a readonly array — used for filter UIs. */
export const ALL_SECURITY_EVENT_TYPES: SecurityEventType[] =
  Object.values(SECURITY_EVENT_TYPES);
