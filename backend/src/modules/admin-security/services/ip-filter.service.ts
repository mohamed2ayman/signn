import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BlockedIpAttempt,
  BlockedIpReason,
} from '../../../database/entities';
import { ipMatchesAny } from '../utils/cidr.util';
import { SecurityPolicyService } from './security-policy.service';

export type IpFilterDecision =
  | { allowed: true }
  | { allowed: false; reason: BlockedIpReason };

/**
 * Checks an inbound IP against the live SecurityPolicy. Always allows
 * loopback/private addresses in non-production so a misconfigured
 * blocklist can't lock developers out.
 */
@Injectable()
export class IpFilterService {
  constructor(
    @InjectRepository(BlockedIpAttempt)
    private readonly blockedRepo: Repository<BlockedIpAttempt>,
    private readonly policy: SecurityPolicyService,
  ) {}

  async check(ip: string | null | undefined): Promise<IpFilterDecision> {
    const policy = await this.policy.getCached();
    if (!policy.ip_filter_enabled) return { allowed: true };
    if (!ip) return { allowed: true };

    // Hard escape hatch outside production: never lock localhost out.
    const isLocal = this.isLocalhost(ip);
    if (isLocal && process.env.NODE_ENV !== 'production') {
      return { allowed: true };
    }

    if (ipMatchesAny(ip, policy.ip_blocklist ?? [])) {
      return { allowed: false, reason: BlockedIpReason.BLOCKLIST };
    }
    if (
      (policy.ip_allowlist?.length ?? 0) > 0 &&
      !ipMatchesAny(ip, policy.ip_allowlist ?? [])
    ) {
      return { allowed: false, reason: BlockedIpReason.NOT_IN_ALLOWLIST };
    }
    return { allowed: true };
  }

  async logBlocked(input: {
    ip: string;
    reason: BlockedIpReason;
    user_agent?: string | null;
    attempted_email?: string | null;
  }): Promise<void> {
    await this.blockedRepo.insert({
      ip_address: input.ip,
      reason: input.reason,
      user_agent: input.user_agent ?? null,
      attempted_email: input.attempted_email ?? null,
    });
  }

  /** Last N blocked attempts (newest first) for the admin UI. */
  async listRecentBlocked(limit = 10): Promise<BlockedIpAttempt[]> {
    return this.blockedRepo.find({
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  private isLocalhost(ip: string): boolean {
    const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
  }
}
