import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Feature #8a — discovery for the caller's guest bindings.
 *
 * `GET /guest/my-contracts` lists the contracts the CALLER holds
 * guest_contract_access bindings for, as a minimal safe projection
 * (GuestBindingListRow — see ContractAccessService). Unified membership
 * (Slice 1) made the binding the sole cross-org grant; this route makes
 * bound contracts DISCOVERABLE (they previously appeared in no list).
 *
 * Deliberate differences from the sibling guest/contracts/:id controllers:
 *   - NO assertGuestSurfaceCaller — that gate takes a target contractId and
 *     this route has none. The query is SELF-SCOPING (WHERE user_id =
 *     caller.id from the JWT, nothing else), so there is no denied resource
 *     to hide: no bindings → [] with 200, never a 404.
 *   - NO account_type gate — the binding is the grant. A GUEST JWT and a
 *     MANAGING JWT each list their own bindings; a managing user's own-org
 *     contracts have no binding rows, so their list is naturally
 *     external-only.
 *
 * A passwordless Viewer credential (Path A — not a JWT) never authenticates
 * here (JwtAuthGuard). The caller's organization_id is never read.
 */
@Controller('guest/my-contracts')
@UseGuards(JwtAuthGuard)
export class GuestMyContractsController {
  constructor(private readonly contractAccess: ContractAccessService) {}

  @Get()
  async listMyContracts(@CurrentUser() user: any) {
    // Identity comes ENTIRELY from the server-side principal (JwtStrategy
    // loaded the User row by token sub). A principal without an id (e.g. a
    // viewer-shaped object injected by a misconfigured guard) is not an
    // authenticated user for this route.
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    // The service returns the explicit safe projection (never the entity) —
    // same sanitized-view posture as guest-status.controller.
    return this.contractAccess.listGuestBindings(user.id);
  }
}
