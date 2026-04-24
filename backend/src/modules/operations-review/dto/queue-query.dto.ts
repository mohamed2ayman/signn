import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  minConfidence?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  maxConfidence?: number;

  @IsOptional()
  @IsString()
  category?: string;
}
