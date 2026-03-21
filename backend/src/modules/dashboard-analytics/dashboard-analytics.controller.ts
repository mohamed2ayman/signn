import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

@Controller('dashboard-analytics')
@UseGuards(JwtAuthGuard)
export class DashboardAnalyticsController {
  constructor(
    private readonly dashboardAnalyticsService: DashboardAnalyticsService,
  ) {}

  @Get()
  async getDashboardAnalytics(@OrganizationId() orgId: string) {
    return this.dashboardAnalyticsService.getDashboardAnalytics(orgId);
  }
}
