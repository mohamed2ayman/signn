import { IsOptional, IsString, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AuditLogQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  /** Exact user UUID match */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Partial match on action string, e.g. "POST", "contracts" */
  @IsOptional()
  @IsString()
  action?: string;

  /** Exact match on entity_type */
  @IsOptional()
  @IsString()
  entityType?: string;

  /** ISO date string — inclusive lower bound on created_at */
  @IsOptional()
  @IsString()
  startDate?: string;

  /** ISO date string — inclusive upper bound on created_at */
  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

/** Used by the export endpoint — same filters, no pagination cap */
export class AuditLogExportQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
