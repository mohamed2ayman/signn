import { IsString, MaxLength } from 'class-validator';

export class UpdateChangeSummaryDto {
  @IsString()
  @MaxLength(1000)
  change_summary: string;
}
