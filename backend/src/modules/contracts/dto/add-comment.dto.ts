import {
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { stripHtml } from '../../../common/utils/sanitize';

export class AddCommentDto {
  @IsString()
  @Transform(({ value }) => stripHtml(value))
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsUUID()
  contract_clause_id?: string;

  @IsOptional()
  @IsUUID()
  parent_comment_id?: string;

  /**
   * When `false`, this managing-user comment is visible to an external guest
   * on the bound contract (a reply meant for the counterparty). Omitted /
   * `true` keeps it internal (the fail-closed default). See ContractComment
   * `is_internal_note`.
   */
  @IsOptional()
  @IsBoolean()
  is_internal_note?: boolean;
}
