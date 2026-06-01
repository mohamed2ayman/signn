import { IsEnum, IsOptional, IsString, IsArray, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { AssetType } from '../../../database/entities';

/**
 * Shared metadata applied to every file in a bulk upload.
 * Title is derived from each file's original name — it is NOT a shared field.
 */
export class BulkCreateKnowledgeAssetDto {
  @IsEnum(AssetType)
  asset_type: AssetType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  jurisdiction?: string;

  /**
   * Multipart sends arrays either as repeated fields or as a JSON-encoded
   * string.  This transform normalises both cases (mirrors CreateKnowledgeAssetDto).
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  })
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  /**
   * Phase 7.24e — optional project scope (shared across all files in the batch).
   * When set, every imported asset is scoped to the specified project.
   */
  @IsOptional()
  @IsUUID()
  project_id?: string;
}
