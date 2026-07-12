import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * A contact person embedded in the party payload (T0c-1 chose EMBEDDED
 * contacts over nested contact routes: create/update carry the full
 * contacts array, so the designated-signatory invariant is validated
 * atomically against the whole party in one place).
 */
export class ContractPartyContactDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsBoolean()
  is_designated_signatory?: boolean;
}
