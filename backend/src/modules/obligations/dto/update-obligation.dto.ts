import { IsString, IsOptional, IsDateString, IsInt, IsEnum, MaxLength, Min, Max } from 'class-validator';
import { ObligationStatus } from '../../../database/entities';

export class UpdateObligationDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  responsible_party?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  frequency?: string;

  @IsOptional()
  @IsEnum(ObligationStatus)
  status?: ObligationStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  reminder_days_before?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidence_url?: string;
}
