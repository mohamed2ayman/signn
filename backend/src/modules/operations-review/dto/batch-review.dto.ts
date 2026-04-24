import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
  MaxLength,
} from 'class-validator';

export enum BatchReviewAction {
  APPROVE = 'APPROVE',
  REJECT  = 'REJECT',
}

export class BatchReviewDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  assetIds: string[];

  @IsEnum(BatchReviewAction)
  action: BatchReviewAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
