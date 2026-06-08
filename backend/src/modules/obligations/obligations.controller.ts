import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { ObligationsService } from './obligations.service';
import { CreateObligationDto, UpdateObligationDto } from './dto';

@Controller('obligations')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class ObligationsController {
  constructor(private readonly obligationsService: ObligationsService) {}

  @Get('contract/:contractId')
  @RequirePermission(PermissionLevel.VIEWER)
  async findByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    // INTERIM (S0): Class-C bypass-role wall — thread the caller's org so the
    // service can findInOrg the contract before loading its obligations.
    @OrganizationId() orgId: string,
  ) {
    return this.obligationsService.findByContract(contractId, orgId);
  }

  // Org-wide reads — no project scope → guard falls through (return true).
  // @RequirePermission omitted intentionally: these are org-aggregates and
  // have no project_id to resolve membership against.
  @Get('upcoming')
  async getUpcoming(@Query('days') days?: string) {
    return this.obligationsService.getUpcoming(
      days ? parseInt(days, 10) : 30,
    );
  }

  @Get('overdue')
  async getOverdue() {
    return this.obligationsService.getOverdue();
  }

  @Get('dashboard')
  async getDashboard(
    @OrganizationId() orgId: string,
    @Query('contract_id') contractId?: string,
  ) {
    // Tenant-isolation Tier 2 — service walls `contract_id` against the
    // caller's org when supplied. Org-wide dashboard (no contract_id) is
    // unchanged.
    return this.obligationsService.getDashboard(orgId, contractId);
  }

  // UUID regex constraint prevents static segments like "portfolio" and "calendar"
  // (registered in ComplianceObligationsController) from being swallowed by this
  // dynamic route. ParseUUIDPipe still validates the value after matching.
  // Fix for Phase 7.2-G — obligation route shadowing.
  @Get(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.VIEWER)
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.obligationsService.findById(id);
  }

  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(@Body() dto: CreateObligationDto) {
    return this.obligationsService.create(dto);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.EDITOR)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObligationDto,
  ) {
    return this.obligationsService.update(id, dto);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/complete')
  @RequirePermission(PermissionLevel.EDITOR)
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { evidence_url?: string },
    @CurrentUser() user: any,
  ) {
    return this.obligationsService.complete(id, user.id, body.evidence_url);
  }

  /** APPROVER required — delete is a destructive, irreversible action. */
  @Delete(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.APPROVER)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.obligationsService.delete(id);
    return { message: 'Obligation deleted successfully' };
  }
}
