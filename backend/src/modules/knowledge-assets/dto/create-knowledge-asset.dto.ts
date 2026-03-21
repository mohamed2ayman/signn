import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { AssetType } from '../../../database/entities';

export class CreateKnowledgeAssetDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AssetType)
  asset_type: AssetType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  jurisdiction?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_in_risk_analysis?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_in_citations?: boolean;
}
