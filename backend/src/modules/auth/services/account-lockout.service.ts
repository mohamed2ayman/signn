import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../../database/entities';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import { SecurityEventService } from '../../admin-security/services/security-event.service';

/**
 * Account-level brute-force lockout — the SINGLE source of truth shared by the
 * login path AND the guest establish-identity real-account password-verify
 * branch, so a locked account is locked for BOTH (Model A: one identity, one
 * lockout state).
 *
 * Before this service the lockout logic was inlined in `AuthService.login`.
 * Ayman's Slice-1 hold-condition: establish-identity verifies an existing
 * account's password but had ONLY the per-IP throttle — strictly weaker
 * brute-force protection on the exact path that grants cross-org bindings.
 * The fix is to REUSE the login lockout, not reimplement it divergently — so
 * the logic lives here and BOTH callers delegate. Any future tuning
 * (threshold / window) changes both paths at once.
 *
 * Mechanism (identical to the pre-extraction login inline logic):
 *  • assertNotLocked — reject while `locked_until` is in the future (403).
 *  • recordFailedAttempt — increment `failed_login_attempts`; at the threshold
 *    stamp `locked_until = now + LOCKOUT_DURATION_MINUTES`; record the
 *    LOGIN_FAILED event always and the ACCOUNT_LOCKED event on the lock.
 *  • clearFailedAttempts — reset the counter + lock on a successful verify.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 30;

@Injectable()
export class AccountLockoutService {
  private readonly logger = new Logger(AccountLockoutService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly securityEvents: SecurityEventService,
  ) {}

  /**
   * Throw ForbiddenException (403) if the account is currently locked. The
   * exception shape (plain-string message with the remaining minutes) is
   * byte-identical to the message the login path threw inline, so login's
   * behaviour is unchanged. Callers run this BEFORE verifying the password.
   */
  assertNotLocked(user: Pick<User, 'locked_until'>): void {
    if (user.locked_until && user.locked_until > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account is locked due to too many failed login attempts. Try again in ${remainingMinutes} minute(s).`,
      );
    }
  }

  /**
   * Record ONE failed password attempt against `user`: increment the counter,
   * and at the threshold stamp the lock window. Always records the
   * LOGIN_FAILED security event; records ACCOUNT_LOCKED when the lock trips.
   *
   * Writes go through the repository's own connection (NOT a caller
   * transaction) so the increment is DURABLE even when the caller rolls back
   * its surrounding transaction after this call — the establish-identity path
   * records the failure AFTER its transaction rolls the 401 back, exactly so
   * the counter persists.
   */
  async recordFailedAttempt(
    user: Pick<User, 'id' | 'email' | 'failed_login_attempts'>,
    ctx: { ip?: string | null; user_agent?: string | null } = {},
  ): Promise<void> {
    const failedAttempts = (user.failed_login_attempts ?? 0) + 1;
    const updateData: Record<string, any> = {
      failed_login_attempts: failedAttempts,
    };

    const locked = failedAttempts >= MAX_FAILED_ATTEMPTS;
    if (locked) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
      updateData.locked_until = lockUntil;
      this.logger.warn(
        `Account locked for user ${user.email} after ${failedAttempts} failed attempts`,
      );
    }

    await this.userRepository.update(user.id, updateData as any);

    await this.recordLoginFailedEvent({
      email: user.email,
      ip: ctx.ip ?? null,
      user_agent: ctx.user_agent ?? null,
      user_id: user.id,
    });

    if (locked) {
      await this.securityEvents.record({
        type: SECURITY_EVENT_TYPES.ACCOUNT_LOCKED,
        actor_id: user.id,
        user_id: user.id,
        ip_address: ctx.ip ?? null,
        metadata: { failed_attempts: failedAttempts },
      });
    }
  }

  /** Reset the counter + lock after a SUCCESSFUL password verify. */
  async clearFailedAttempts(user: Pick<User, 'id'>): Promise<void> {
    await this.userRepository.update(user.id, {
      failed_login_attempts: 0,
      locked_until: null as unknown as Date,
    });
  }

  /**
   * Best-effort LOGIN_FAILED audit write — never throws (a security-log hiccup
   * must not mask the auth failure). Moved verbatim from AuthService's private
   * `_recordLoginFailure`.
   */
  private async recordLoginFailedEvent(input: {
    email: string;
    ip: string | null;
    user_agent: string | null;
    user_id?: string | null;
  }): Promise<void> {
    try {
      await this.securityEvents.record({
        type: SECURITY_EVENT_TYPES.LOGIN_FAILED,
        user_id: input.user_id ?? null,
        ip_address: input.ip,
        metadata: { email: input.email, user_agent: input.user_agent },
      });
    } catch (error) {
      this.logger.warn(
        `[lockout] Failed to record failed-login security event: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
