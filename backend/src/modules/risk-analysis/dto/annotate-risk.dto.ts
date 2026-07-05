import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RiskLevel } from '../../../database/entities';

/**
 * Phase 8.3 — editable Risk Analysis tab.
 *
 * Body for `PATCH /risk-analysis/:id` — a human correction of the AI's
 * `risk_level` and/or `risk_category`. Both fields are optional; the service
 * rejects a body with neither (`BadRequestException`). `risk_category` is
 * further validated against the ACTIVE `risk_categories` taxonomy (the 8
 * official buckets) inside the service — the DTO only bounds its shape.
 *
 * NOTE: this endpoint edits the label layer (level + category) ONLY. It does
 * NOT touch likelihood/impact — those are the separate B.3 override endpoint
 * (`PATCH :id/override`), which carries its own drift/learned-baseline
 * machinery that annotation deliberately avoids.
 */
export class AnnotateRiskDto {
  @IsOptional()
  @IsEnum(RiskLevel)
  risk_level?: RiskLevel;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  risk_category?: string;
}
