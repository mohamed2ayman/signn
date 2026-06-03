import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { CreateGuestInvitationDto } from '../dto/create-guest-invitation.dto';

/**
 * Phase 7.18 bucket 1b-i — authenticated invitation management.
 *
 * Endpoints:
 *   POST /guest-invitations           — create (managing user)
 *   DELETE /guest-invitations/:id     — revoke (managing user)
 *
 * Authorization is enforced inside the service via
 * ContractAccessService.findInOrg(contract_id, caller.organization_id) —
 * NOT by trusting any client-supplied org id.
 *
 * 1b-i is the EXTERNAL guest branch. This controller does NOT touch
 * internal contract-sharing or ContractShare.
 */
@Controller('guest-invitations')
@UseGuards(JwtAuthGuard)
export class GuestInvitationsController {
  constructor(private readonly invitations: GuestInvitationService) {}

  @Post()
  async create(
    @Body() dto: CreateGuestInvitationDto,
    @CurrentUser() user: any,
  ) {
    const { invitation, token } = await this.invitations.create(dto, {
      id: user.id,
      organization_id: user.organization_id ?? null,
    });
    // The raw token is returned so bucket-7 email delivery can later
    // attach a delivery side-effect WITHOUT changing the API shape.
    // Note: this endpoint is JWT-guarded — the token is only visible to
    // the inviter who already has full access to the contract.
    return {
      invitation: {
        id: invitation.id,
        contract_id: invitation.contract_id,
        invited_email: invitation.invited_email,
        invited_language: invitation.invited_language,
        status: invitation.status,
        expires_at: invitation.expires_at,
        created_by: invitation.created_by,
        created_at: invitation.created_at,
      },
      token,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const invitation = await this.invitations.revoke(id, {
      id: user.id,
      organization_id: user.organization_id ?? null,
    });
    return {
      id: invitation.id,
      status: invitation.status,
      revoked_at: invitation.revoked_at,
    };
  }
}
