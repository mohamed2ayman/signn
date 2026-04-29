import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import {
  AuditLog,
  BlockedIpAttempt,
  User,
} from '../../../database/entities';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService } from './session.service';

export interface SecurityScoreComponent {
  key: string;
  label: string;
  weight: number;
  /** 0..1 — fraction of weight earned. */
  score: number;
  /** Human-readable detail, e.g. "62% of admins have MFA". */
  detail: string;
  /** Suggested action if score < 1. */
  recommendation?: string;
}

export interface SecurityScoreResult {
  /** 0..100 integer */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: SecurityScoreComponent[];
  computed_at: string;
}

/**
 * Computes a 0–100 security posture score from 6 weighted components.
 *
 *   1. MFA adoption (admins)         — 25 pts
 *   2. Password policy strength      — 15 pts
 *   3. Suspicious sessions (24h)     — 15 pts (inverted)
 *   4. Account lockout configured    — 10 pts
 *   5. IP filter active              — 15 pts
 *   6. Recent blocked attempts       — 20 pts (inverted)
 *
 * Pure read model — no writes. Cached client-side, recomputed on demand.
 */
@Injectable()
export class SecurityScoreService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(BlockedIpAttempt)
    private readonly blockedRepo: Repository<BlockedIpAttempt>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly policy: SecurityPolicyService,
    private readonly sessions: SessionService,
  ) {}

  async compute(): Promise<SecurityScoreResult> {
    const policy = await this.policy.get();

    const components: SecurityScoreComponent[] = [];

    // 1. MFA adoption among privileged users (admins + owners)
    const adminRoles = ['SYSTEM_ADMIN', 'OWNER_ADMIN'];
    const totalAdmins = await this.userRepo
      .createQueryBuilder('u')
      .where('u.role IN (:...roles)', { roles: adminRoles })
      .getCount();
    const mfaAdmins = await this.userRepo
      .createQueryBuilder('u')
      .where('u.role IN (:...roles)', { roles: adminRoles })
      .andWhere('u.mfa_enabled = true')
      .getCount();
    const mfaRatio = totalAdmins === 0 ? 1 : mfaAdmins / totalAdmins;
    components.push({
      key: 'mfa_adoption',
      label: 'Admin MFA adoption',
      weight: 25,
      score: mfaRatio,
      detail:
        totalAdmins === 0
          ? 'No privileged users on this platform'
          : `${mfaAdmins} of ${totalAdmins} admin/owner users have MFA enabled`,
      recommendation:
        mfaRatio < 1 ? 'Enable MFA for all admin and owner accounts' : undefined,
    });

    // 2. Password policy strength (count of "strong" rules satisfied / 6)
    const passwordChecks = [
      policy.password_min_length >= 12,
      policy.password_require_upper,
      policy.password_require_lower,
      policy.password_require_number,
      policy.password_require_symbol,
      policy.password_history_count > 0,
    ];
    const passwordPassed = passwordChecks.filter(Boolean).length;
    const passwordRatio = passwordPassed / passwordChecks.length;
    components.push({
      key: 'password_policy',
      label: 'Password policy strength',
      weight: 15,
      score: passwordRatio,
      detail: `${passwordPassed}/6 strong password rules enforced`,
      recommendation:
        passwordRatio < 1
          ? 'Tighten the password policy in Security Settings'
          : undefined,
    });

    // 3. Suspicious sessions in the last 24h (inverted; 0 = perfect)
    const suspiciousCount = await this.sessions.countActiveSuspicious();
    const suspiciousRatio = suspiciousCount === 0 ? 1 : Math.max(0, 1 - suspiciousCount / 5);
    components.push({
      key: 'suspicious_sessions',
      label: 'Active suspicious sessions',
      weight: 15,
      score: suspiciousRatio,
      detail:
        suspiciousCount === 0
          ? 'No active suspicious sessions'
          : `${suspiciousCount} active suspicious session(s) flagged`,
      recommendation:
        suspiciousCount > 0 ? 'Review and revoke suspicious sessions' : undefined,
    });

    // 4. Lockout policy in effect
    const lockoutActive =
      policy.lockout_max_attempts > 0 && policy.lockout_max_attempts <= 10;
    components.push({
      key: 'lockout_policy',
      label: 'Account lockout configured',
      weight: 10,
      score: lockoutActive ? 1 : 0,
      detail: lockoutActive
        ? `Locks after ${policy.lockout_max_attempts} attempts for ${policy.lockout_duration_minutes} min`
        : 'Account lockout is disabled or set too high',
      recommendation: lockoutActive
        ? undefined
        : 'Set lockout to 5 attempts / 15 minutes',
    });

    // 5. IP filter active (any allow OR block list, with the master switch on)
    const filterOn =
      policy.ip_filter_enabled &&
      ((policy.ip_allowlist?.length ?? 0) > 0 ||
        (policy.ip_blocklist?.length ?? 0) > 0);
    components.push({
      key: 'ip_filter',
      label: 'IP filter active',
      weight: 15,
      score: filterOn ? 1 : 0,
      detail: filterOn
        ? `IP filter on (${policy.ip_allowlist?.length ?? 0} allow, ${policy.ip_blocklist?.length ?? 0} block)`
        : 'No IP filtering configured',
      recommendation: filterOn
        ? undefined
        : 'Add at least one allowlist or blocklist entry',
    });

    // 6. Recent blocked attempts (24h) — inverted
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const blocked24h = await this.blockedRepo.count({
      where: { created_at: MoreThan(since) },
    });
    const blockedRatio = blocked24h === 0 ? 1 : Math.max(0, 1 - blocked24h / 20);
    components.push({
      key: 'blocked_attempts',
      label: 'Blocked-IP volume (24h)',
      weight: 20,
      score: blockedRatio,
      detail:
        blocked24h === 0
          ? 'No blocked attempts in the last 24h'
          : `${blocked24h} blocked attempt(s) in 24h`,
      recommendation:
        blocked24h >= 20
          ? 'Investigate blocked-IP spike for active attack'
          : undefined,
    });

    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const earned = components.reduce((s, c) => s + c.weight * c.score, 0);
    const score = Math.round((earned / totalWeight) * 100);

    return {
      score,
      grade: this.gradeOf(score),
      components,
      computed_at: new Date().toISOString(),
    };
  }

  private gradeOf(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
}
