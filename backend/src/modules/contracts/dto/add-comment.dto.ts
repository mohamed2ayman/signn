import { IsString, IsUUID, IsOptional } from 'class-validator';

export class AddCommentDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsUUID()
  contract_clause_id?: string;

  @IsOptional()
  @IsUUID()
  parent_comment_id?: string;
}
