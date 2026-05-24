import {
  IsString,
  IsEnum,
  IsUUID,
  IsOptional,
  IsBoolean,
  MaxLength,
  IsDateString,
  IsInt,
  Min,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { ContractType, LicenseOrganization } from '../../../database/entities';

export class CreateContractDto {
  @IsUUID()
  project_id: string;

  @IsString()
  @MaxLength(500)
  name: string;

  @IsEnum(ContractType)
  contract_type: ContractType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  party_type?: string;

  @IsOptional()
  @IsBoolean()
  license_acknowledged?: boolean;

  @IsOptional()
  @IsEnum(LicenseOrganization)
  license_organization?: LicenseOrganization;

  // ─── Phase 7.1 — Contract date fields ──────────────────────────────────

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsDateString()
  effective_date?: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  notice_period_days?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defects_liability_period_days?: number;

  // ─── Phase 7.1 — Escalation contact ────────────────────────────────────

  /**
   * Escalation contact as a platform user UUID.
   * Mutually exclusive with escalation_contact_email — provide one or neither,
   * never both. Validation: if escalation_contact_email is present, this must
   * be absent (and vice versa).
   */
  @IsOptional()
  @ValidateIf((o) => !o.escalation_contact_email)
  @IsUUID()
  escalation_contact_user_id?: string;

  /**
   * Escalation contact as an external email address.
   * Mutually exclusive with escalation_contact_user_id.
   */
  @IsOptional()
  @ValidateIf((o) => !o.escalation_contact_user_id)
  @IsEmail()
  escalation_contact_email?: string;
}
