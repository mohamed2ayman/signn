import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ManagingOrGuestCaller } from './services/contract-access.service';
import { NegotiationStatusService } from './services/negotiation-status.service';

/**
 * 7.19 Slice 2 — negotiation status endpoints (managing authenticated
 * surface, NOT /guest/*).
 *
 * No PermissionLevelGuard (the RedlineController precedent): the READ must
 * serve a bound counterparty who is not a ProjectMember, so authorization
 * lives at the service seam per operation — agree / ready-to-sign are
 * host-org-only via findInOrg (a guest account, having no org, gets the same
 * uniform 404 — no guest path exists); the status read rides
 * findAccessibleContract (either bound party).
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class NegotiationStatusController {
  constructor(private readonly negotiation: NegotiationStatusService) {}

  private callerOf(user: any): ManagingOrGuestCaller {
    return {
      id: user.id,
      organization_id: user.organization_id ?? null,
      role: user.role,
      account_type: user.account_type,
    };
  }

  @Get('contracts/:contractId/negotiation')
  async getStatus(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    return this.negotiation.getStatus(contractId, this.callerOf(user));
  }

  @Post('contracts/:contractId/negotiation/agree')
  @HttpCode(HttpStatus.OK)
  async agree(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    return this.negotiation.agree(contractId, this.callerOf(user));
  }

  @Post('contracts/:contractId/negotiation/ready-to-sign')
  @HttpCode(HttpStatus.OK)
  async readyToSign(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    return this.negotiation.readyToSign(contractId, this.callerOf(user));
  }
}
