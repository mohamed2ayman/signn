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
} from 'class-validator';
import { PlaybookRuleType, PlaybookScope } from '../../../database/entities';

/**
 * 7.22 Slice 1 — PATCH /playbook/positions/:id body.
 *
 * Written out explicitly rather than via PartialType — the codebase has no
 * `@nestjs/mapped-types` usage; every update DTO here is hand-written with
 * `@IsOptional()` (the UpdateConnectionDto / UpdateObligationDto precedent).
 *
 * NOTE the absent `@Validate(ValueConfigMatchesRuleTypeConstraint)`: on a PATCH
 * the DTO can see only the half the caller sent, so validating the pair HERE
 * would be wrong in both directions — it would reject a lone `value_config`
 * (no rule_type to check against) and accept a lone `rule_type` switch that
 * orphans the stored config. PlaybookService therefore re-validates the MERGED
 * pair; that is the ONLY correct place. Same reasoning for scope coherence.
 *
 * `organization_id` is not updatable — a position cannot change owner. Nor is
 * `created_by`: it records who authored it, not who last touched it.
 */
export class UpdatePlaybookPositionDto {
  @IsOptional()
  @IsEnum(PlaybookScope)
  scope?: PlaybookScope;

  /** Explicit null clears the narrowing (e.g. re-scoping CONTRACT → ORG). */
  @IsOptional()
  @IsUUID()
  project_id?: string | null;

  @IsOptional()
  @IsUUID()
  contract_id?: string | null;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clause_type?: string;

  @IsOptional()
  @IsBoolean()
  is_custom_clause_type?: boolean;

  @IsOptional()
  @IsEnum(PlaybookRuleType)
  rule_type?: PlaybookRuleType;

  @IsOptional()
  @IsObject()
  value_config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
