import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsObject,
  MaxLength,
  Min,
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
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  currency?: string;

  @IsInt()
  @Min(1)
  duration_days: number;

  @IsInt()
  @Min(1)
  max_projects: number;

  @IsInt()
  @Min(1)
  max_users: number;

  @IsInt()
  @Min(1)
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
