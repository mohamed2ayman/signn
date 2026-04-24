import { IsEnum, IsOptional } from 'class-validator';

export enum AnalyticsTab {
  OVERVIEW = 'overview',
  SUBSCRIPTIONS = 'subscriptions',
  USERS = 'users',
  CONTRACTS = 'contracts',
  KNOWLEDGE = 'knowledge',
  PERFORMANCE = 'performance',
}

export enum AnalyticsPeriod {
  P7 = '7d',
  P30 = '30d',
  P90 = '90d',
  P365 = '365d',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsTab)
  tab?: AnalyticsTab;

  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod;
}
