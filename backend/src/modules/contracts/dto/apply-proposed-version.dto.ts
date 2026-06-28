import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Guest version review — Sub-slice 2a. The host's per-clause decisions for a
 * guest-proposed version (a proposed set identified by source_document_id).
 *
 * A proposed clause is identified by its is_proposed=true junction row id
 * (`proposed_contract_clause_id`). Its disposition:
 *   - accept           → promote as-is. If `replaces_contract_clause_id` is set,
 *                        it replaces that LIVE clause via the parent-chain
 *                        (new version, original retired); if absent, it is ADDED
 *                        as a brand-new live clause.
 *   - edit             → like accept (replace/add) but with the HOST's wording
 *                        (`edited_title`/`edited_content`); status EDITED.
 *   - reject           → NO-OP on the contract; the proposed row is discarded.
 */
export class ApplyProposedClauseDecisionDto {
  @IsUUID()
  proposed_contract_clause_id: string;

  @IsIn(['accept', 'reject', 'edit'])
  action: 'accept' | 'reject' | 'edit';

  /**
   * The LIVE (is_proposed=false) junction row this proposed clause replaces.
   * Present → MODIFY/MERGE via parent-chain. Absent → ADD (new clause, no parent).
   */
  @IsOptional()
  @IsUUID()
  replaces_contract_clause_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  edited_title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  edited_content?: string;
}

/**
 * A host decision on a guest-proposed REMOVAL of an existing original clause.
 *   - accept → remove the named LIVE clause (retired; snapshot preserves it).
 *   - reject → keep it (NO-OP).
 */
export class ApplyRemovalDecisionDto {
  @IsUUID()
  contract_clause_id: string;

  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';
}

export class ApplyProposedVersionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyProposedClauseDecisionDto)
  decisions: ApplyProposedClauseDecisionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyRemovalDecisionDto)
  removals?: ApplyRemovalDecisionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_summary?: string;
}
