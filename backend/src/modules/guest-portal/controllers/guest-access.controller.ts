import {
  Body,
  Controller,
  Get,
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
 * Guest Portal #8c Part 4a/4b — HOST control over guest bindings.
 *
 *   GET  /guest-access/:contractId/guests   — who has access to MY contract
 *   POST /guest-access/:contractId/revoke   — withdraw a counterparty's access
 *
 * This is the HOST twin of `GuestInvitationsController` (which revokes the
 * INVITATION); this one manages the BINDING the invitation produced. Same
 * shape, same authorization model: `JwtAuthGuard` here, and the real check —
 * `ContractAccessService.findInOrg(contractId, actor.organization_id)` —
 * enforced INSIDE the service, never by trusting a client-supplied org id.
 *
 * Deliberately NOT under `/guest/*`: every route in that namespace is a GUEST
 * surface authorized by the binding. These routes must be unreachable that
 * way — a bound counterparty may not list or revoke anyone. Keeping them on
 * their own top-level path makes the host-vs-guest split visible in the URL.
 *
 * POST (not DELETE) because the operation is a soft state transition that
 * returns the resulting stamp, and because the binding has no id of its own in
 * the caller's hands — it is addressed by (contract, user).
 */
@Controller('guest-access')
@UseGuards(JwtAuthGuard)
export class GuestAccessController {
  constructor(private readonly guestAccess: GuestAccessService) {}

  /**
   * #8c Part 4b — the list feeding the "who has access" UI. Returns BOTH
   * live and revoked bindings (revoked_at populated on the latter) as the
   * explicit HostGuestBindingRow projection — each row carries the user_id
   * the revoke endpoint below takes.
   */
  @Get(':contractId/guests')
  async listGuests(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    return this.guestAccess.listGuests(contractId, {
      id: user.id,
      organization_id: user.organization_id ?? null,
    });
  }

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
