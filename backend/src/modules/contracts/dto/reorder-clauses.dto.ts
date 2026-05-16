import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

class ClauseOrderItem {
  @IsUUID()
  id: string;

  @IsInt()
  @Min(0)
  order_index: number;
}

export class ReorderClausesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClauseOrderItem)
  clauses: ClauseOrderItem[];
}
