import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ObligationStatus } from '../../../database/entities';

export class UpdateObligationInlineDto {
  @IsOptional()
  @IsEnum(ObligationStatus)
  status?: ObligationStatus;

  @IsOptional()
  @IsDateString()
  completed_at?: string;
}
