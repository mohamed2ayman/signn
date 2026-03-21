import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsObject,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsString()
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
}
