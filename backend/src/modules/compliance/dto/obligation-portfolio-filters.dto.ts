import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
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
