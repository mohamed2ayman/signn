import { IsString, IsOptional, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripHtml } from '../../../common/utils/sanitize';

export class CreateClauseDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  @Transform(({ value }) => stripHtml(value))
  @MaxLength(500000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clause_type?: string;
}
