import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AnalyticsPeriod } from '../../admin-analytics/dto';

// Re-export so consumers of this DTO have the enum in one place.
export { AnalyticsPeriod };

/**
 * Query params for GET /portfolio-analytics.
 *
 * `period` drives the QoQ-style deltas + the time-to-signature trend window
 * (rolling, not calendar quarters — see Phase 7.17 Prompt 2a, Decision D2).
 * The distribution/value/expiration widgets are current-state snapshots and
 * ignore `period`. `project_id` optionally scopes every widget to one project.
 */
export class PortfolioAnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod;

  @IsOptional()
  @IsUUID()
  project_id?: string;
}
