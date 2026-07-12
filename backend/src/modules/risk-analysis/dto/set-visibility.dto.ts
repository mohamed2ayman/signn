import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Risk-tab clutter reduction — body for
 * `PUT /risk-analysis/clause/:contractClauseId/visibility`.
 * The exactly-2 chosen visible risk ids for a clause (the swap override).
 */
export class SetClauseVisibilityDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsUUID('4', { each: true })
  visible_risk_ids: string[];
}
