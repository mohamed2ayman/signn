import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateClauseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clause_type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
