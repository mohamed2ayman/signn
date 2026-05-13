import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MaxLength(500)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  currency?: string;

  @IsInt()
  duration_days: number;

  @IsInt()
  max_projects: number;

  @IsInt()
  max_users: number;

  @IsInt()
  max_contracts_per_project: number;

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
