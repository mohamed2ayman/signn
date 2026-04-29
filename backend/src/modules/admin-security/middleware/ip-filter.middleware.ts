import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { IpFilterService } from '../services/ip-filter.service';
import { SecurityEventService } from '../services/security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';

/**
 * Hard gate for inbound traffic. Runs before the JWT guard so an
 * attacker on a blocked IP can't even hit /auth/login. Pulls the
 * live SecurityPolicy via the service's 60s cache so this is hot-path
 * safe.
 *
 * Skips itself for health/metrics endpoints so the platform doesn't
 * accidentally fail liveness probes.
 */
@Injectable()
export class IpFilterMiddleware implements NestMiddleware {
  private static readonly SKIP_PREFIXES = ['/api/v1/health', '/health'];

  constructor(
    private readonly ipFilter: IpFilterService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = req.path || req.url || '';
    if (IpFilterMiddleware.SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      return next();
    }

    const ip = this.extractIp(req);
    const decision = await this.ipFilter.check(ip);
    if (decision.allowed) return next();

    // Block — log + audit
    await this.ipFilter.logBlocked({
      ip: ip ?? 'unknown',
      reason: decision.reason,
      user_agent: (req.headers['user-agent'] as string) ?? null,
      attempted_email:
        (req.body as { email?: string } | undefined)?.email ?? null,
    });
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.IP_BLOCKED,
      ip_address: ip,
      metadata: { reason: decision.reason, path },
    });
    throw new ForbiddenException('Access denied from this network');
  }

  private extractIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
    return first || req.ip || req.socket?.remoteAddress || null;
  }
}
