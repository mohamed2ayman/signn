import {
  IsString,
  IsEnum,
  IsUUID,
  IsOptional,
  IsBoolean,
  MaxLength,
  IsDateString,
  IsInt,
  IsNumber,
  Min,
  IsEmail,
  Matches,
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

  /**
   * Multi-tier T0a — relationship-type CODE from the
   * contract_relationship_types registry (MAIN / SUBCONTRACT / …).
   * Optional; omitted = unclassified/legacy (column stays NULL).
   * DELIBERATELY not an @IsEnum/@IsIn — the registry (DB rows) is the single
   * source of valid codes, so adding a type is a seed row, not a code change.
   * ContractsService.create() normalizes first (''/whitespace-only = "no
   * selection" → NULL, code trimmed) then validates the code exists AND is
   * active, rejecting unknown/inactive codes with a clear 400.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationship_type?: string;

  /**
   * Multi-tier T0b — parent-contract link. Supplied when the chosen
   * relationship_type's registry parent_link_rule is 'required' or 'optional'
   * (e.g. a SUBCONTRACT's parent MAIN). MUST be absent for 'none' types
   * (MAIN / USUFRUCT). ContractsService.create() enforces the rule +
   * allowed_parent_types + org scope (findInOrg wall) + self/cycle guards.
   * Create-time only in v1 — deliberately NOT on UpdateContractDto (parent is
   * set at creation, not editable post-create).
   */
  @IsOptional()
  @IsUUID()
  parent_contract_id?: string;

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

  // ─── Phase 7.17 Prompt 2a — Portfolio value ────────────────────────────

  /** Total contract value (monetary). Optional; pair with `currency`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contract_value?: number;

  /**
   * ISO-4217 currency code (3 uppercase letters). Deliberately NOT marked
   * @IsOptional: the @ValidateIf makes it REQUIRED whenever contract_value is
   * set (a value with no currency is meaningless), while remaining optional
   * when no value is provided. Validators are skipped entirely when
   * contract_value is null/undefined.
   */
  @ValidateIf((o) => o.contract_value != null)
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO-4217 code',
  })
  currency?: string;
}
