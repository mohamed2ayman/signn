import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * SecurityPolicy — singleton row (id = 'global') holding platform-wide
 * security configuration. Read-cached for 60s by IpFilterMiddleware and
 * the lockout path; written via PUT /api/v1/admin/security/policy.
 *
 * Fields with `_minutes`/`_days`/`_attempts` semantics are admin-tunable.
 * `lockout_duration_minutes = -1` is sentinel for "permanent until manual unlock".
 * `password_expiry_days = null` means "never expires".
 * `password_history_count = 0` means "no reuse-prevention".
 */
@Entity('security_policies')
export class SecurityPolicy {
  /** Always 'global' for v1 — per-org overrides are out of scope. */
  @PrimaryColumn({ type: 'varchar', length: 20 })
  id: string;

  // ── Session ──
  @Column({ type: 'int', default: 240 })
  session_timeout_minutes: number;

  // ── Password complexity ──
  @Column({ type: 'int', default: 8 })
  password_min_length: number;

  @Column({ type: 'boolean', default: true })
  password_require_upper: boolean;

  @Column({ type: 'boolean', default: true })
  password_require_lower: boolean;

  @Column({ type: 'boolean', default: true })
  password_require_number: boolean;

  @Column({ type: 'boolean', default: true })
  password_require_symbol: boolean;

  /** Days until password expires. NULL = never expires. */
  @Column({ type: 'int', nullable: true })
  password_expiry_days: number | null;

  /** Number of past hashes a new password may not match. 0 = no history. */
  @Column({ type: 'int', default: 0 })
  password_history_count: number;

  // ── Lockout ──
  @Column({ type: 'int', default: 5 })
  lockout_max_attempts: number;

  /** -1 = permanent until manual admin unlock. */
  @Column({ type: 'int', default: 30 })
  lockout_duration_minutes: number;

  // ── Per-role MFA enforcement ──
  @Column({ type: 'boolean', default: false })
  mfa_required_system_admin: boolean;

  @Column({ type: 'boolean', default: false })
  mfa_required_operations: boolean;

  @Column({ type: 'boolean', default: false })
  mfa_required_owner_admin: boolean;

  // ── IP filter ──
  @Column({ type: 'boolean', default: false })
  ip_filter_enabled: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  ip_allowlist: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  ip_blocklist: string[];

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
