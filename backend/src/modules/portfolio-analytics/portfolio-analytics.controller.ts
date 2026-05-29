import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { UserRole } from '../../database/entities';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';
import {
  PortfolioAnalyticsQueryDto,
  AnalyticsPeriod,
} from './dto/portfolio-analytics-query.dto';

/**
 * GET /portfolio-analytics — OWNER_ADMIN-only portfolio dashboard data.
 *
 * Gated at TWO layers: this RolesGuard (@Roles OWNER_ADMIN) at the API, and a
 * ProtectedRoute on the frontend route (2b). Org scope is taken from the JWT
 * via @OrganizationId() — never a client-supplied org_id.
 */
@Controller('portfolio-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PortfolioAnalyticsController {
  constructor(private readonly service: PortfolioAnalyticsService) {}

  @Get()
  @Roles(UserRole.OWNER_ADMIN)
  getPortfolioAnalytics(
    @OrganizationId() orgId: string,
    @Query() query: PortfolioAnalyticsQueryDto,
  ) {
    const period = query.period ?? AnalyticsPeriod.P90;
    return this.service.getPortfolioAnalytics(orgId, period, query.project_id);
  }
}
