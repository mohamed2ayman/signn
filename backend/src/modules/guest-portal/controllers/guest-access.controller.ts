import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GuestAccessService } from '../services/guest-access.service';
import { RevokeGuestAccessDto } from '../dto/revoke-guest-access.dto';

/**
 * Guest Portal #8c Part 4a — HOST control over guest bindings.
 *
 *   POST /guest-access/:contractId/revoke   — withdraw a counterparty's access
 *
 * This is the HOST twin of `GuestInvitationsController` (which revokes the
 * INVITATION); this one revokes the BINDING the invitation produced. Same
 * shape, same authorization model: `JwtAuthGuard` here, and the real check —
 * `ContractAccessService.findInOrg(contractId, actor.organization_id)` —
 * enforced INSIDE the service, never by trusting a client-supplied org id.
 *
 * Deliberately NOT under `/guest/*`: every route in that namespace is a GUEST
 * surface authorized by the binding. This route must be unreachable that way —
 * a bound counterparty may not revoke anyone. Keeping it on its own top-level
 * path makes the host-vs-guest split visible in the URL.
 *
 * POST (not DELETE) because the operation is a soft state transition that
 * returns the resulting stamp, and because the binding has no id of its own in
 * the caller's hands — it is addressed by (contract, user).
 */
@Controller('guest-access')
@UseGuards(JwtAuthGuard)
export class GuestAccessController {
  constructor(private readonly guestAccess: GuestAccessService) {}

  @Post(':contractId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: RevokeGuestAccessDto,
    @CurrentUser() user: any,
  ) {
    // Idempotent: re-revoking returns the ORIGINAL stamp with
    // already_revoked=true rather than erroring or re-stamping.
    return this.guestAccess.revoke(contractId, dto.user_id, {
      id: user.id,
      organization_id: user.organization_id ?? null,
    });
  }
}
