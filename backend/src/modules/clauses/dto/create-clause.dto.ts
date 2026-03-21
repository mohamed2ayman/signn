import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateClauseDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clause_type?: string;
}
