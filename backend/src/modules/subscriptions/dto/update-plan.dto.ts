import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  currency?: string;

  @IsOptional()
  @IsInt()
  duration_days?: number;

  @IsOptional()
  @IsInt()
  max_projects?: number;

  @IsOptional()
  @IsInt()
  max_users?: number;

  @IsOptional()
  @IsInt()
  max_contracts_per_project?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  require_mfa?: boolean;
}
