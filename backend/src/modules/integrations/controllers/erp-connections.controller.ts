import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OrganizationId } from '../../../common/decorators/organization.decorator';
import { UserRole } from '../../../database/entities';
import { ErpEnabledGuard } from '../guards/erp-enabled.guard';
import { ErpConnectionService } from '../services/erp-connection.service';
import { CreateConnectionDto } from '../dto/create-connection.dto';
import { UpdateConnectionDto } from '../dto/update-connection.dto';
import { SetFieldMappingsDto } from '../dto/set-field-mappings.dto';
import { TriggerSyncDto } from '../dto/trigger-sync.dto';
import {
  ErpSyncDirection,
  ErpSyncDomain,
} from '../connectors/erp-connector.interface';

/**
 * Phase 7.28 — per-org ERP connection management.
 *
 * Org-scoped (org id from JWT, never the body) and gated to OWNER_ADMIN. The
 * feature gate (ErpEnabledGuard) runs after auth so the surface 404s when off.
 * Credential fields are never returned (service strips them + entity @Exclude).
 */
@Controller('erp/connections')
@UseGuards(JwtAuthGuard, RolesGuard, ErpEnabledGuard)
@Roles(UserRole.OWNER_ADMIN)
export class ErpConnectionsController {
  constructor(private readonly service: ErpConnectionService) {}

  @Post()
  create(
    @OrganizationId() orgId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    return this.service.create(orgId, dto);
  }

  @Get()
  list(@OrganizationId() orgId: string) {
    return this.service.list(orgId);
  }

  @Get(':id')
  get(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(orgId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.service.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(orgId, id);
  }

  @Get(':id/mappings')
  getMappings(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getMappings(orgId, id);
  }

  @Put(':id/mappings')
  setMappings(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFieldMappingsDto,
  ) {
    return this.service.setMappings(orgId, id, dto);
  }

  @Post(':id/sync')
  triggerSync(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriggerSyncDto,
  ) {
    return this.service.triggerSync(
      orgId,
      id,
      dto.direction ?? ErpSyncDirection.IMPORT,
      dto.domain ?? ErpSyncDomain.COST,
    );
  }

  @Get(':id/jobs')
  listJobs(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listJobs(orgId, id);
  }
}
