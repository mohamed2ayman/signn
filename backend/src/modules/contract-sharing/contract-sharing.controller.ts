import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ContractSharingService } from './contract-sharing.service';

@Controller('contract-sharing')
export class ContractSharingController {
  constructor(private readonly sharingService: ContractSharingService) {}

  /**
   * Create a new share link for a contract (requires auth)
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createShare(
    @CurrentUser() user: any,
    @Body()
    body: {
      contract_id: string;
      shared_with_email: string;
      permission?: string;
      expires_in_days?: number;
    },
  ) {
    return this.sharingService.createShare({
      contractId: body.contract_id,
      sharedBy: user.id,
      sharedWithEmail: body.shared_with_email,
      permission: body.permission || 'view',
      expiresInDays: body.expires_in_days,
    });
  }

  /**
   * Get all shares for a contract (requires auth)
   */
  @Get('contract/:contractId')
  @UseGuards(JwtAuthGuard)
  async getSharesByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.sharingService.getSharesByContract(contractId);
  }

  /**
   * Access a shared contract via token (public — no auth)
   */
  @Get('shared/:token')
  async accessSharedContract(@Param('token') token: string) {
    return this.sharingService.getContractByShareToken(token);
  }

  /**
   * Revoke a share (requires auth)
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async revokeShare(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    await this.sharingService.revokeShare(id, user.id);
    return { message: 'Share revoked' };
  }
}
