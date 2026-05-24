import { IsDateString } from 'class-validator';

export class ObligationCalendarQueryDto {
  /** Range start — ISO date string (required). */
  @IsDateString()
  from: string;

  /** Range end — ISO date string (required, max 1 year from `from`). */
  @IsDateString()
  to: string;
}
