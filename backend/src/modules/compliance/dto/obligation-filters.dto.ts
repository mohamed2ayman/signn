import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ObligationStatus } from '../../../database/entities';

export class ObligationFiltersDto {
  @IsOptional()
  @IsString()
  party?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsEnum(ObligationStatus)
  status?: ObligationStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
