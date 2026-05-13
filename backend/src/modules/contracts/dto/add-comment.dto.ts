import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
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
}
