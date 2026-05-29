import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Phase 7.17 — Prompt 1, B.3.
 *
 * Body shape for `PATCH /risk-analyses/:id/override`. Validation runs
 * via the global NestJS `ValidationPipe({ whitelist: true, transform:
 * true })` set in main.ts — out-of-range values, wrong types, or
 * unknown fields produce a 400 automatically.
 *
 * `note` is intentionally optional per Operator Flag 4 — required
 * notes suppress overrides; optional notes preserve user behaviour.
 * If a future phase requires audit-grade notes, drop the
 * `@IsOptional()` and re-run the existing happy-path tests that omit
 * the field.
 */
export class OverrideRiskDto {
  /** New Likelihood (PMBOK 1-5 scale). */
  @IsInt()
  @Min(1)
  @Max(5)
  likelihood: number;

  /** New Impact (PMBOK 1-5 scale). */
  @IsInt()
  @Min(1)
  @Max(5)
  impact: number;

  /**
   * Optional user-provided rationale for the override. Stored verbatim
   * in `risk_analysis_override_log.note` for audit-trail purposes.
   * 2000-char cap matches the rest of the override-log payload sizing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
