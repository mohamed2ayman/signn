import { IsArray, IsUUID, ArrayMaxSize } from 'class-validator';

export class ClauseIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(500)
  clause_ids: string[];
}
