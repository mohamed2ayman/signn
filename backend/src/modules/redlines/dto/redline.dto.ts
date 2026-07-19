import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * 7.19 Slice 1 — counterparty redlining DTOs.
 *
 * Redline unit = CLAUSE-LEVEL BLOCK-REPLACE: `proposedContent` is the FULL
 * replacement clause body, not a patch. 500k caps mirror the clause-content
 * tier from Phase 3.2 (`CreateClauseDto.content`); notes use the 10k
 * comment tier. Every free-text field is @MaxLength-capped (Phase 3.2 hard
 * rule: no unbounded strings in DTOs).
 */
export class ProposeRedlineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500000)
  proposedContent: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proposedTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string;
}

/**
 * Accept — empty body = promote the proposal as-is (review_status APPROVED).
 * `editedContent` present = the host modifies while accepting (EDITED), the
 * applyProposedVersion `edit` semantic. `note` lands on decision_note.
 */
export class AcceptRedlineDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  editedTitle?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500000)
  editedContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string;
}

export class RejectRedlineDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string;
}

export class CounterRedlineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500000)
  proposedContent: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proposedTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string;
}

/** GET /contracts/:contractId/redlines query filters. */
export class ListRedlinesQueryDto {
  @IsOptional()
  @IsIn(['PROPOSED', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN', 'STALE'])
  status?: string;

  @IsOptional()
  @IsUUID()
  contractClauseId?: string;
}
