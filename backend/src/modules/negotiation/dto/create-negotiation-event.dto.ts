import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { NegotiationEventType } from '../../../database/entities';
import { stripHtml } from '../../../common/utils/sanitize';

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
  @Transform(({ value }) => stripHtml(value))
  @MaxLength(500000)
  original_text?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => stripHtml(value))
  @MaxLength(500000)
  new_text?: string;
}
