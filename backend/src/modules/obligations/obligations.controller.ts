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
  // PRE-S2c HOTFIX: thread the caller's org so the service can apply the
  // canonical contract→project org predicate (these were platform-wide).
  @Get('upcoming')
  async getUpcoming(
    @OrganizationId() orgId: string,
    @Query('days') days?: string,
  ) {
    return this.obligationsService.getUpcoming(
      orgId,
      days ? parseInt(days, 10) : 30,
    );
  }

  @Get('overdue')
  async getOverdue(@OrganizationId() orgId: string) {
    return this.obligationsService.getOverdue(orgId);
  }

  @Get('dashboard')
  async getDashboard(
    @OrganizationId() orgId: string,
    @Query('contract_id') contractId?: string,
  ) {
    // Tenant-isolation Tier 2 — service walls `contract_id` against the
    // caller's org when supplied. POST-#60 HOTFIX: the contract-less branch
    // is org-scoped in the service via the canonical contract→project join
    // (it previously ran platform-wide — that was a bug, not a feature).
    return this.obligationsService.getDashboard(orgId, contractId);
  }

  // UUID regex constraint prevents static segments like "portfolio" and "calendar"
  // (registered in ComplianceObligationsController) from being swallowed by this
  // dynamic route. ParseUUIDPipe still validates the value after matching.
  // Fix for Phase 7.2-G — obligation route shadowing.
  // PRE-S2c HOTFIX: the /:id surface threads the caller's org so findById
  // can wall the obligation's contract via findInOrg (cross-tenant → 404).
  // Permission gating (7.15) and the org wall are independent gates.
  @Get(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.VIEWER)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.obligationsService.findById(id, orgId);
  }

  // HOTFIX (pre-S2d): thread the caller's org so the service can wall
  // dto.contract_id via findInOrg before inserting. The route middleware
  // can't resolve a project for this route (contract_id is in the body, not
  // a param), so the permission guard alone does not org-scope the write —
  // the org wall is the gate. Permission gating and the org wall are
  // independent.
  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(
    @Body() dto: CreateObligationDto,
    @OrganizationId() orgId: string,
  ) {
    return this.obligationsService.create(dto, orgId);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.EDITOR)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObligationDto,
    @OrganizationId() orgId: string,
  ) {
    return this.obligationsService.update(id, dto, orgId);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/complete')
  @RequirePermission(PermissionLevel.EDITOR)
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { evidence_url?: string },
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.obligationsService.complete(
      id,
      user.id,
      orgId,
      body.evidence_url,
    );
  }

  /** APPROVER required — delete is a destructive, irreversible action. */
  @Delete(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  @RequirePermission(PermissionLevel.APPROVER)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    await this.obligationsService.delete(id, orgId);
    return { message: 'Obligation deleted successfully' };
  }
}
