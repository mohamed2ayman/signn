import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../database/entities';
import { ErpEnabledGuard } from '../guards/erp-enabled.guard';
import { ErpConnectionService } from '../services/erp-connection.service';

/**
 * Phase 7.28 — SYSTEM_ADMIN cross-tenant ERP health view.
 *
 * Read-only list of every org's connections (vendor, status, last_sync_at,
 * error) for the admin "ERP sync status dashboard". Credentials are never
 * returned (service strips them). Distinct from the OWNER_ADMIN per-org
 * management surface.
 */
@Controller('admin/erp')
@UseGuards(JwtAuthGuard, RolesGuard, ErpEnabledGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminErpController {
  constructor(private readonly service: ErpConnectionService) {}

  @Get('connections')
  listConnections() {
    return this.service.adminListConnections();
  }
}
