import {
  IsString,
  IsOptional,
  MaxLength,
  IsDateString,
  IsInt,
  IsNumber,
  Min,
  IsEmail,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  /**
   * @deprecated Superseded by `host_party_role_code`. Still accepted and still
   * persisted unchanged — Slice 1a alters nothing about this field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  party_type?: string;

  /**
   * Party Foundation Slice 1a — party-role CODE from the party_roles registry
   * naming which party the HOST organisation represents. Registry-validated in
   * ContractsService.update() against ACTIVE rows (unknown AND inactive codes
   * both rejected). Send '' to clear it back to NULL.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  host_party_role_code?: string;

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
   * never both.
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
   * ISO-4217 currency code (3 uppercase letters). Format-validated whenever
   * present, but the value↔currency PAIRING is intentionally NOT enforced here:
   * payload-only validation cannot see the persisted currency, so requiring it
   * in the payload would wrongly reject a value-only update on an
   * already-priced contract. The pairing is enforced on the merged entity in
   * contracts.service.update() via assertValueCurrencyPaired().
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO-4217 code',
  })
  currency?: string;
}
