import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Phase 7.28 — feature gate.
 *
 * ERP integration is OPTIONAL and OFF by default (`ERP_INTEGRATION_ENABLED`
 * defaults to false). When off, every ERP route 404s as if the surface does
 * not exist — SIGN runs 100% without the feature. Applied AFTER JwtAuthGuard so
 * an unauthenticated probe still 401s first (no feature-existence disclosure).
 */
@Injectable()
export class ErpEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('ERP_INTEGRATION_ENABLED')) {
      throw new NotFoundException('ERP integration is not enabled.');
    }
    return true;
  }
}
