import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GuestSignSlipService } from '../../contracts/services/guest-sign-slip.service';

/**
 * Guest Signing v1 — the guest sign door.
 *
 *   GET  /guest/contracts/:id/sign-slip         — slip status (the frontend's
 *                                                 render gate for "Accept &
 *                                                 Execute")
 *   POST /guest/contracts/:id/sign-slip/accept  — Accept & Execute: slip
 *                                                 PENDING→ACCEPTED →
 *                                                 pinExecutedContract (door
 *                                                 'GUEST_SIGN') → EXECUTED.
 *
 * IMPORT-controller posture (NOT assertGuestSurfaceCaller — that gate passes
 * GUEST accounts without a binding check, and signing requires BINDING + SLIP
 * for EVERY account type): class-level JwtAuthGuard, identity taken ENTIRELY
 * from the server-side principal, authorization lives in the SERVICE's atomic
 * gate — both probes (binding, slip) run unconditionally, then ONE combined
 * check throws the uniform 404. No-binding and binding-but-no-slip are
 * indistinguishable (same status, same body, same timing-class — never
 * `{active:false}`, no existence oracle). The gate never reads
 * organization_id, never branches on account_type, never touches APPROVER.
 *
 * A passwordless Viewer credential (Path A — not a JWT) never authenticates
 * here.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestSignController {
  constructor(private readonly guestSignSlips: GuestSignSlipService) {}

  @Get(':id/sign-slip')
  async getSlip(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    // A principal without an id (e.g. a viewer-shaped object injected by a
    // misconfigured guard) is not an authenticated user for this route —
    // same posture as guest-import / guest-my-contracts.
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    return this.guestSignSlips.getSlipForGuest(contractId, user.id);
  }

  @Post(':id/sign-slip/accept')
  @HttpCode(HttpStatus.OK)
  async acceptAndExecute(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    return this.guestSignSlips.acceptAndExecute(contractId, user.id);
  }
}
