import { IsUUID, IsOptional, IsString, IsInt, MaxLength } from 'class-validator';

export class AddClauseDto {
  @IsUUID()
  clause_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  section_number?: string;

  @IsOptional()
  @IsInt()
  order_index?: number;

  @IsOptional()
  customizations?: Record<string, unknown>;
}
