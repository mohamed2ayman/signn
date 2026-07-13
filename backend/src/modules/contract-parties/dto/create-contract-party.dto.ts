import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ContractPartyContactDto } from './contract-party-contact.dto';

export class CreateContractPartyDto {
  /** Soft code from the party_roles registry — service-validated (active + applies_to contract/both). */
  @IsString()
  @MaxLength(50)
  role_code: string;

  // Trim first (global ValidationPipe has transform: true), then require
  // non-empty so a whitespace-only name is a 400 — matching the frontend's
  // "Enter an organisation name". The service re-checks for direct callers.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  org_name: string;

  @IsOptional()
  @IsBoolean()
  is_signatory?: boolean;

  /** Optional link to a SIGN organization (v1: host org only — service-validated). */
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  legal_tax_card?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  legal_address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContractPartyContactDto)
  contacts?: ContractPartyContactDto[];
}
