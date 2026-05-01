import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { PasswordHistory, User } from '../../../database/entities';
import { SecurityPolicyService } from './security-policy.service';

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates new passwords against the live SecurityPolicy and manages
 * the optional password-history reuse-prevention list.
 */
@Injectable()
export class PasswordPolicyService {
  private static readonly BCRYPT_SALT_ROUNDS = 10;

  private readonly logger = new Logger(PasswordPolicyService.name);

  constructor(
    @InjectRepository(PasswordHistory)
    private readonly historyRepo: Repository<PasswordHistory>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly policy: SecurityPolicyService,
  ) {}

  /** Synchronously validates the candidate against the live policy (complexity only). */
  async validateComplexity(candidate: string): Promise<PasswordValidationResult> {
    const policy = await this.policy.get();
    const errors: string[] = [];
    if (candidate.length < policy.password_min_length) {
      errors.push(`must be at least ${policy.password_min_length} characters`);
    }
    if (policy.password_require_upper && !/[A-Z]/.test(candidate)) {
      errors.push('must include an uppercase letter');
    }
    if (policy.password_require_lower && !/[a-z]/.test(candidate)) {
      errors.push('must include a lowercase letter');
    }
    if (policy.password_require_number && !/[0-9]/.test(candidate)) {
      errors.push('must include a number');
    }
    if (
      policy.password_require_symbol &&
      !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(candidate)
    ) {
      errors.push('must include a symbol');
    }
    return { ok: errors.length === 0, errors };
  }

  /** Throws BadRequest with a multi-line message if validation fails. */
  async assertComplexity(candidate: string): Promise<void> {
    const result = await this.validateComplexity(candidate);
    if (!result.ok) {
      throw new BadRequestException(`Password ${result.errors.join('; ')}`);
    }
  }

  /**
   * If `password_history_count > 0`, rejects the candidate when it
   * matches any of the user's last N password hashes (including the
   * current `users.password_hash`).
   */
  async assertNotReused(userId: string, candidate: string): Promise<void> {
    const policy = await this.policy.get();
    if (policy.password_history_count <= 0) return;

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user?.password_hash && (await bcrypt.compare(candidate, user.password_hash))) {
      throw new BadRequestException(
        'New password must differ from your current password',
      );
    }

    const history = await this.historyRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: policy.password_history_count,
    });
    for (const row of history) {
      if (await bcrypt.compare(candidate, row.password_hash)) {
        throw new BadRequestException(
          `New password must differ from your last ${policy.password_history_count} password(s)`,
        );
      }
    }
  }

  /** Add a hash to history and trim the list to the current N. */
  async appendToHistory(userId: string, oldHash: string): Promise<void> {
    const policy = await this.policy.get();
    if (policy.password_history_count <= 0) return;

    await this.historyRepo.insert({ user_id: userId, password_hash: oldHash });

    // Trim to N most recent (delete older ones)
    const all = await this.historyRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
    const toDelete = all.slice(policy.password_history_count);
    if (toDelete.length > 0) {
      await this.historyRepo.delete(toDelete.map((r) => r.id));
    }
  }

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, PasswordPolicyService.BCRYPT_SALT_ROUNDS);
  }

  /** Returns true if the user's password is past the policy expiry window. */
  async isExpired(user: User): Promise<boolean> {
    const policy = await this.policy.get();
    if (!policy.password_expiry_days) return false;
    if (!user.password_changed_at) return false;
    const cutoff = new Date(
      user.password_changed_at.getTime() +
        policy.password_expiry_days * 24 * 60 * 60 * 1000,
    );
    return cutoff < new Date();
  }
}
