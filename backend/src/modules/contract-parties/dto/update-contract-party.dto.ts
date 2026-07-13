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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ContractPartyContactDto } from './contract-party-contact.dto';

/**
 * Standalone update DTO (does NOT extend the create DTO — Phase 3.2 rule:
 * standalone update DTOs inherit nothing; every field re-decorated here).
 *
 * `contacts` semantics: undefined = leave the existing contacts untouched;
 * an array (including []) = FULL REPLACE of the party's contacts.
 * `organization_id: null` explicitly clears the org link.
 */
export class UpdateContractPartyDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role_code?: string;

  // Optional on update, but when supplied it must be non-empty after trimming
  // (matches create + the frontend). undefined = leave org_name unchanged.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  org_name?: string;

  @IsOptional()
  @IsBoolean()
  is_signatory?: boolean;

  /** null clears the link; a uuid must resolve in the host org (service-validated). */
  @IsOptional()
  @ValidateIf((o) => o.organization_id !== null)
  @IsUUID()
  organization_id?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.legal_tax_card !== null)
  @IsString()
  @MaxLength(100)
  legal_tax_card?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.legal_address !== null)
  @IsString()
  @MaxLength(2000)
  legal_address?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContractPartyContactDto)
  contacts?: ContractPartyContactDto[];
}
