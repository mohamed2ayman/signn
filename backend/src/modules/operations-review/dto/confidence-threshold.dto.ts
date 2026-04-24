import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class ConfidenceThresholdDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  threshold: number;
}
