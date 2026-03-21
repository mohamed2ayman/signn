import { IsString, IsUUID, IsOptional, IsDateString, IsInt, IsEnum, MaxLength } from 'class-validator';
import { ObligationStatus } from '../../../database/entities';

export class CreateObligationDto {
  @IsUUID()
  contract_id: string;

  @IsOptional()
  @IsUUID()
  contract_clause_id?: string;

  @IsString()
  description: string;

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
  @IsInt()
  reminder_days_before?: number;
}
