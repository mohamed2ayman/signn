import {
  IsUUID,
  IsEnum,
  IsString,
  IsEmail,
  IsOptional,
  IsObject,
} from 'class-validator';
import { PartyType } from '../../../database/entities';

export class CreatePartyDto {
  @IsUUID()
  project_id: string;

  @IsEnum(PartyType)
  party_type: PartyType;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  contact_person?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, boolean>;
}
