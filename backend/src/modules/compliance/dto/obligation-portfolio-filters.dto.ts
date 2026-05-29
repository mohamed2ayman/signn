import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ObligationStatus, ObligationType } from '../../../database/entities';

export class ObligationPortfolioFiltersDto {
  /** Filter by date range — start (ISO date, inclusive). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Filter by date range — end (ISO date, inclusive). */
  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Convenience window: restrict to obligations due within the next N days
   * (today .. today+N). The service translates this to from/to. If explicit
   * `from` or `to` is also supplied, those win and `within` is ignored —
   * so omitting `within` reproduces the exact pre-existing behaviour.
   * Used by the Portfolio dashboard's "upcoming obligations (14d)" panel.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  within?: number;

  /** Restrict to a single project. */
  @IsOptional()
  @IsUUID()
  project_id?: string;

  /** Filter by obligation lifecycle status. */
  @IsOptional()
  @IsEnum(ObligationStatus)
  status?: ObligationStatus;

  /** Filter by obligation type. */
  @IsOptional()
  @IsEnum(ObligationType)
  type?: ObligationType;

  /** Filter to obligations assigned to a specific user UUID. */
  @IsOptional()
  @IsUUID()
  assignee?: string;
}
