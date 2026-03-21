import { IsEnum } from 'class-validator';
import { AssetReviewStatus } from '../../../database/entities';

export class ReviewAssetDto {
  @IsEnum(AssetReviewStatus)
  review_status: AssetReviewStatus;
}
