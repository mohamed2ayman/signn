import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsQueryDto, AnalyticsPeriod, AnalyticsTab } from './dto';

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminAnalyticsController {
  constructor(private readonly service: AdminAnalyticsService) {}

  @Get()
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  getAnalytics(@Query() query: AnalyticsQueryDto) {
    const tab = query.tab ?? AnalyticsTab.OVERVIEW;
    const period = query.period ?? AnalyticsPeriod.P30;
    return this.service.getAnalytics(tab, period);
  }
}
