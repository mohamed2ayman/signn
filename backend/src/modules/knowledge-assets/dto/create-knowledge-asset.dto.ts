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

  /**
   * Multipart sends arrays either as repeated fields (Multer gives string|string[])
   * or as a JSON-encoded string. This transform normalises both cases.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [value]; }
    catch { return [value]; }
  })
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
