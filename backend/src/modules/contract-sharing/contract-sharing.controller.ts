import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ContractSharingService } from './contract-sharing.service';
import { CreateShareDto } from './dto/create-share.dto';

@Controller('contract-sharing')
export class ContractSharingController {
  constructor(private readonly sharingService: ContractSharingService) {}

  /**
   * Search org members for the share autocomplete (requires auth)
   * GET /contract-sharing/org-members?q=<query>
   */
  @Get('org-members')
  @UseGuards(JwtAuthGuard)
  async searchOrgMembers(
    @OrganizationId() orgId: string,
    @Query('q') q: string,
  ) {
    return this.sharingService.searchOrgMembers(orgId, q || '');
  }

  /**
   * Create a new share link for a contract (requires auth)
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createShare(
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
    @Body() body: CreateShareDto,
  ) {
    return this.sharingService.createShare({
      contractId: body.contract_id,
      sharedBy: user.id,
      orgId,
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
    @OrganizationId() orgId: string,
  ) {
    return this.sharingService.getSharesByContract(contractId, orgId);
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
