import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ViewerCredentialService } from '../services/viewer-credential.service';

/**
 * Phase 7.18 bucket 1b-i — guards routes that accept ONLY a viewer credential.
 *
 * Expected header shape:
 *   Authorization: Viewer <token>
 *
 * On success, populates `req.user` with a viewer-shaped caller that
 * ContractAccessService.findAccessibleContract recognizes via
 * `type === 'viewer'`. The caller object is intentionally sparse — there
 * is no user_id, no role, no organization — so that any code that tries
 * to use it as a normal authenticated user will fail loudly rather than
 * silently fall through to a managing-user code path.
 *
 * SECURITY FLOOR (mirrors portfolio-export-download.controller §3 #11):
 *  • This guard is the entire auth gate on `/viewer/*` routes — there is
 *    no JwtAuthGuard behind it.
 *  • Verification is HMAC-only, stateless, no DB call. The TTL (default
 *    15 min) is the recovery window for revocation.
 *  • The guard MUST throw 401 on any failure (malformed / signature /
 *    expired) so the controller never sees an invalid credential.
 */
@Injectable()
export class ViewerCredentialGuard implements CanActivate {
  constructor(private readonly viewerService: ViewerCredentialService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = (req.headers?.authorization ?? '') as string;

    // Expected: "Viewer <token>" (case-insensitive scheme).
    const match = /^Viewer\s+(.+)$/i.exec(auth.trim());
    if (!match) {
      throw new UnauthorizedException('Viewer credential required');
    }
    const token = match[1].trim();

    const result = this.viewerService.verify(token);
    if (!result.ok) {
      // Single generic 401 — never leak which axis failed. Mirrors the
      // portfolio-export download "Invalid download link." behaviour.
      throw new UnauthorizedException('Invalid viewer credential');
    }

    req.user = {
      type: 'viewer',
      viewer: {
        contract_id: result.payload.contract_id,
        invitation_id: result.payload.invitation_id,
      },
    };
    return true;
  }
}
