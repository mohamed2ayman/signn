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
import { NoticesService } from './notices.service';
import {
  CreateNoticeDto,
  UpdateNoticeStatusDto,
  CreateNoticeResponseDto,
} from './dto';

@Controller('notices')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(
    @Body() dto: CreateNoticeDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.noticesService.create(dto, user.id, orgId);
  }

  @Get()
  @RequirePermission(PermissionLevel.VIEWER)
  async findAllByContract(
    @Query('contract_id', ParseUUIDPipe) contractId: string,
  ) {
    return this.noticesService.findAllByContract(contractId);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.noticesService.findById(id);
  }

  @Put(':id/acknowledge')
  @RequirePermission(PermissionLevel.EDITOR)
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.noticesService.acknowledge(id, user.id);
  }

  @Post(':id/respond')
  @RequirePermission(PermissionLevel.EDITOR)
  async respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoticeResponseDto,
    @CurrentUser() user: any,
  ) {
    return this.noticesService.respond(id, dto, user.id);
  }

  @Put(':id/status')
  @RequirePermission(PermissionLevel.APPROVER)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoticeStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.noticesService.updateStatus(id, dto, user.id);
  }

  @Put(':id/withdraw')
  @RequirePermission(PermissionLevel.EDITOR)
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.noticesService.withdraw(id, user.id);
  }
}
