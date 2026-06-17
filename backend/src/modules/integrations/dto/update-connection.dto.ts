import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 7.28 — PATCH /erp/connections/:id body.
 *
 * `vendor` is intentionally NOT updatable — changing it would invalidate the
 * capability snapshot and field mappings. Re-create the connection instead.
 * Supplying `credentials` re-encrypts and replaces the stored payload; omitting
 * it leaves the existing credentials untouched.
 */
export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  base_url?: string | null;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
