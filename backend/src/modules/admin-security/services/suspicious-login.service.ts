import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SuspiciousReason, UserSession } from '../../../database/entities';

export interface SuspiciousEvaluationInput {
  user_id: string;
  ip: string | null;
  country_code: string | null;
  /** Number of failed login attempts in the last 15 minutes for this user. */
  recent_failure_count: number;
}

export interface SuspiciousEvaluationResult {
  is_suspicious: boolean;
  reason: SuspiciousReason | null;
}

/**
 * Heuristic suspicious-login detector. Runs at login time on the success
 * path (and on failure for brute-force flagging). Pure-DB lookups only —
 * no external services.
 *
 * Rules:
 *   1. ≥5 failed attempts in last 15 min → BRUTE_FORCE
 *   2. country_code differs from every prior session country in the
 *      last 24h → if there were already ≥2 distinct countries, IMPOSSIBLE_TRAVEL
 *      else NEW_COUNTRY
 */
@Injectable()
export class SuspiciousLoginService {
  private static readonly BRUTE_FORCE_THRESHOLD = 5;

  constructor(
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
  ) {}

  async evaluate(
    input: SuspiciousEvaluationInput,
  ): Promise<SuspiciousEvaluationResult> {
    if (input.recent_failure_count >= SuspiciousLoginService.BRUTE_FORCE_THRESHOLD) {
      return { is_suspicious: true, reason: SuspiciousReason.BRUTE_FORCE };
    }

    if (!input.country_code) {
      return { is_suspicious: false, reason: null };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await this.sessionRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.country_code', 'country_code')
      .where('s.user_id = :uid', { uid: input.user_id })
      .andWhere('s.created_at > :since', { since })
      .andWhere('s.country_code IS NOT NULL')
      .getRawMany<{ country_code: string }>();

    const distinctPrior = rows
      .map((r) => r.country_code)
      .filter((c) => !!c);

    if (distinctPrior.length === 0) {
      // First-ever login (or no recent country) — not flagged
      return { is_suspicious: false, reason: null };
    }

    if (distinctPrior.includes(input.country_code)) {
      return { is_suspicious: false, reason: null };
    }

    // New country
    if (distinctPrior.length >= 2) {
      return {
        is_suspicious: true,
        reason: SuspiciousReason.IMPOSSIBLE_TRAVEL,
      };
    }
    return { is_suspicious: true, reason: SuspiciousReason.NEW_COUNTRY };
  }
}
