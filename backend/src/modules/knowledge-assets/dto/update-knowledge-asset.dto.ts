import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, MaxLength } from 'class-validator';
import { AssetType, AssetReviewStatus } from '../../../database/entities';

export class UpdateKnowledgeAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(AssetType)
  asset_type?: AssetType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  jurisdiction?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  include_in_risk_analysis?: boolean;

  @IsOptional()
  @IsBoolean()
  include_in_citations?: boolean;
}
