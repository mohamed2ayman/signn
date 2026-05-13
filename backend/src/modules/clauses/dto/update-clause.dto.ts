import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripHtml } from '../../../common/utils/sanitize';

export class UpdateClauseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => stripHtml(value))
  @MaxLength(500000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clause_type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
