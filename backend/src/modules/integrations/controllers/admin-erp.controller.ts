import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities';
import { ErpEnabledGuard } from '../guards/erp-enabled.guard';
import { ErpAdminService } from '../services/erp-admin.service';
import { ErpOperatorReasonDto } from '../dto/operator-reason.dto';

/**
 * Phase 7.28 — SYSTEM_ADMIN cross-tenant ERP control surface.
 *
 * v1: read-only health list. v1.1: operator actions — suspend / unsuspend /
 * force-check / guarded-delete. Every action is reason-required and written to
 * the immutable audit log; the customer is notified. Credentials are never
 * returned, never entered, never edited here (operators govern PERMISSION TO
 * OPERATE only). Cross-tenant safety = this SYSTEM_ADMIN gate + audit (ERP is
 * org-scoped, not behind the Option B contract chokepoint — finding #0).
 */
@Controller('admin/erp')
@UseGuards(JwtAuthGuard, RolesGuard, ErpEnabledGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminErpController {
  constructor(private readonly admin: ErpAdminService) {}

  @Get('connections')
  listConnections() {
    return this.admin.listConnections();
  }

  @Post('connections/:id/suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ErpOperatorReasonDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.admin.suspend(id, user.id, dto.reason);
  }

  @Post('connections/:id/unsuspend')
  unsuspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ErpOperatorReasonDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.admin.unsuspend(id, user.id, dto.reason);
  }

  @Post('connections/:id/force-check')
  @HttpCode(202)
  forceCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ErpOperatorReasonDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.admin.requestForceCheck(id, user.id, dto.reason);
  }

  @Delete('connections/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ErpOperatorReasonDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.admin.remove(id, user.id, dto.reason);
  }
}
