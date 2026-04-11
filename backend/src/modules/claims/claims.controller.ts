import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { PermissionLevel } from '../../database/entities';
import { ClaimsService } from './claims.service';
import {
  CreateClaimDto,
  UpdateClaimStatusDto,
  CreateClaimResponseDto,
  UploadClaimDocumentDto,
} from './dto';

@Controller('claims')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(
    @Body() dto: CreateClaimDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.claimsService.create(dto, user.id, orgId);
  }

  @Get()
  @RequirePermission(PermissionLevel.VIEWER)
  async findAllByContract(
    @Query('contract_id', ParseUUIDPipe) contractId: string,
  ) {
    return this.claimsService.findAllByContract(contractId);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.claimsService.findById(id);
  }

  @Put(':id/acknowledge')
  @RequirePermission(PermissionLevel.EDITOR)
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.claimsService.acknowledge(id, user.id);
  }

  @Post(':id/respond')
  @RequirePermission(PermissionLevel.EDITOR)
  async respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClaimResponseDto,
    @CurrentUser() user: any,
  ) {
    return this.claimsService.respond(id, dto, user.id);
  }

  @Put(':id/status')
  @RequirePermission(PermissionLevel.APPROVER)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClaimStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.claimsService.updateStatus(id, dto, user.id);
  }

  @Post(':id/documents')
  @RequirePermission(PermissionLevel.EDITOR)
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadClaimDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.claimsService.uploadDocument(id, dto, user.id);
  }

  @Put(':id/withdraw')
  @RequirePermission(PermissionLevel.EDITOR)
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.claimsService.withdraw(id, user.id);
  }
}
