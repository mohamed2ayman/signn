import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { User, UserRole } from '../../../database/entities';
import { DriftReportService } from '../services/drift-report.service';

/**
 * Phase 7.17 — Prompt 1, B.5.
 *
 * Org-wide risk-drift report for the F.3 dashboard. OWNER_ADMIN only —
 * the report exposes the org's aggregate override behaviour, which is a
 * privileged, organisation-level view (not a per-finding read like the
 * explanation endpoint). The service scopes every query by the caller's
 * `organization_id`, so cross-org leakage is impossible regardless of the
 * gate.
 */
@Controller('settings/risk-drift')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskDriftController {
  constructor(private readonly driftReport: DriftReportService) {}

  @Get()
  @Roles(UserRole.OWNER_ADMIN)
  async getDriftReport(@CurrentUser() user: User) {
    return this.driftReport.getDriftReport(user.organization_id);
  }
}
