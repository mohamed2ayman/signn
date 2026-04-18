import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuditLogQueryDto, AuditLogExportQueryDto } from './dto/audit-log-query.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminAuditLogController {
  constructor(private readonly auditLogService: AdminAuditLogService) {}

  /**
   * GET /api/v1/admin/audit-logs/filters
   * Returns all distinct action values, entity types, and organizations
   * for populating the filter dropdowns.
   */
  @Get('audit-logs/filters')
  async getFilters() {
    return this.auditLogService.getFilters();
  }

  /**
   * GET /api/v1/admin/audit-logs/export
   * Returns all matching rows (no pagination) for CSV download.
   */
  @Get('audit-logs/export')
  async exportAuditLogs(@Query() query: AuditLogExportQueryDto) {
    return this.auditLogService.exportAuditLogs(query);
  }

  /**
   * GET /api/v1/admin/audit-logs
   * Paginated, filterable audit log list.
   */
  @Get('audit-logs')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.getAuditLogs(query);
  }
}
