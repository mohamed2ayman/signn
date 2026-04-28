import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NegotiationEventType } from '../../../database/entities';

export class CreateNegotiationEventDto {
  @IsUUID()
  contract_id: string;

  @IsString()
  @MaxLength(255)
  clause_ref: string;

  @IsEnum(NegotiationEventType)
  event_type: NegotiationEventType;

  @IsOptional()
  @IsString()
  original_text?: string;

  @IsOptional()
  @IsString()
  new_text?: string;
}
