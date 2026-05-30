import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AnalyticsPeriod } from '../../admin-analytics/dto';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — POST /portfolio-exports body.
 *
 * Shape mirrors PortfolioAnalyticsQueryDto (the 2a endpoint's query):
 * `period` (defaults to P90 if omitted) and an optional `project_id`
 * filter. user_id, org_id, and email are pulled from the JWT in the
 * controller — NEVER from the request body — to prevent client-supplied
 * scoping from bypassing the OWNER_ADMIN gate.
 */
export class CreatePortfolioExportDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod;

  @IsOptional()
  @IsUUID()
  project_id?: string;
}
