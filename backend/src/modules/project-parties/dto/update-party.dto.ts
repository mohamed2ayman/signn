import {
  IsEnum,
  IsString,
  IsEmail,
  IsOptional,
  IsObject,
} from 'class-validator';
import { PartyType } from '../../../database/entities';

export class UpdatePartyDto {
  @IsOptional()
  @IsEnum(PartyType)
  party_type?: PartyType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

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
