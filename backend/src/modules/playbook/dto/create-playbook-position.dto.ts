import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import { PlaybookRuleType, PlaybookScope } from '../../../database/entities';
import { ValueConfigMatchesRuleTypeConstraint } from './value-config.validator';

/**
 * 7.22 Slice 1 — POST /playbook/positions body.
 *
 * `organization_id` is deliberately ABSENT: the owning org comes from the JWT
 * via `@OrganizationId()` and is NEVER client-supplied (ARCHITECTURE RULE 3).
 * `created_by` likewise comes from the authenticated principal.
 *
 * LAYER SPLIT — deliberate, so no rule is half-enforced in two places:
 *   - THIS DTO validates FORMAT (types, enums, lengths) and the
 *     rule_type ↔ value_config PAIR (both halves are always present on create).
 *   - SCOPE COHERENCE (scope ↔ project_id/contract_id) is validated ONLY in
 *     PlaybookService, because an UPDATE can change any one of the three
 *     independently and only the service sees the merged result. Enforcing it
 *     partially here too would mean two authorities that could drift.
 *   - The `playbook_positions_scope_coherence_check` DB constraint is the final
 *     backstop, not the user-facing check (it would surface as a 500).
 */
export class CreatePlaybookPositionDto {
  @IsOptional()
  @IsEnum(PlaybookScope)
  scope?: PlaybookScope;

  /** Set for a PROJECT position (service enforces when it is required/forbidden). */
  @IsOptional()
  @IsUUID()
  project_id?: string;

  /** Set for a CONTRACT position (service enforces when it is required/forbidden). */
  @IsOptional()
  @IsUUID()
  contract_id?: string;

  /**
   * A standard key (`payment`, `liability`, …) or an org's own string — 7.22
   * requires "any custom clause type the org wants to track", so there is no
   * backend allowlist. Trimmed first (the global ValidationPipe has
   * transform: true) so a whitespace-only value is a 400, matching the
   * `CreateContractPartyDto.org_name` precedent.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clause_type: string;

  @IsOptional()
  @IsBoolean()
  is_custom_clause_type?: boolean;

  @IsEnum(PlaybookRuleType)
  rule_type: PlaybookRuleType;

  /**
   * Shape depends on `rule_type` — validated as a PAIR by the shared authority
   * in value-config.validator.ts (`@IsObject` alone would accept `{}`).
   */
  @IsObject()
  @Validate(ValueConfigMatchesRuleTypeConstraint)
  value_config: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
