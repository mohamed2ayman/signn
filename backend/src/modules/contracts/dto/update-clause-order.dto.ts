import { IsUUID, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClauseOrderDto {
  @IsOptional()
  @IsInt()
  order_index?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  section_number?: string;

  @IsOptional()
  customizations?: Record<string, unknown>;
}
