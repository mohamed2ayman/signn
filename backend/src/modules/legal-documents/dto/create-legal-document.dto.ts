import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsUUID,
  IsInt,
  IsIn,
  IsUrl,
  MaxLength,
  Min,
  Max,
  IsISO8601,
  ArrayMaxSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LegalDocumentSourceType, LegalDocumentStatus } from '../../../database/entities';

/**
 * Jurisdiction whitelist — Q4 decision: varchar(10) on the DB column,
 * DTO-layer enforcement via @IsIn.  New countries require only a DTO change,
 * never a DB migration.
 */
export const ALLOWED_JURISDICTIONS = ['EG', 'AE', 'SA', 'QA', 'UK'] as const;
export type AllowedJurisdiction = typeof ALLOWED_JURISDICTIONS[number];

/**
 * Language whitelist — Q5 decision: varchar(5)[] Postgres array.
 * Each element must be a known language code.
 */
export const ALLOWED_LANGUAGES = ['AR', 'EN', 'FR'] as const;

export class CreateLegalDocumentDto {
  // ── Required fields ─────────────────────────────────────────────────────

  /** ISO-3166-1 alpha-2 jurisdiction code. */
  @IsString()
  @IsIn(ALLOWED_JURISDICTIONS)
  jurisdiction: string;

  @IsEnum(LegalDocumentSourceType)
  source_type: LegalDocumentSourceType;

  @IsString()
  @MaxLength(500)
  title: string;

  /**
   * UUID of the legal_sources row this document was published by.
   * REQUIRED — the source carries the is_visual_order flag that decides whether
   * the chunker reverses Arabic word order.  Sources are catalogued via SQL
   * (no admin endpoint in v1).
   */
  @IsUUID()
  source_id: string;

  // ── Law reference (all optional) ─────────────────────────────────────────

  /**
   * Canonical law number (without year).
   * e.g. '131' for Egyptian Civil Code Law 131/1948.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  law_number?: string;

  /** Gregorian year of enactment. e.g. 1948 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1800)
  @Max(2100)
  law_year?: number;

  /**
   * Full enactment date in ISO-8601 format (YYYY-MM-DD).
   * Stored as DATE in PostgreSQL.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  gregorian_date?: string;

  /**
   * Hijri date stored as free-form string.
   * Convention: 'YYYY-MM-DD', 'YYYY-MM', or 'YYYY'.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hijri_date?: string;

  // ── Status ───────────────────────────────────────────────────────────────

  @IsOptional()
  @IsEnum(LegalDocumentStatus)
  status?: LegalDocumentStatus;

  // ── Language ─────────────────────────────────────────────────────────────

  /**
   * Multipart sends arrays either as repeated fields or as a JSON-encoded
   * string. This transform normalises both cases (mirrors the pattern in
   * CreateKnowledgeAssetDto.tags).
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value as string);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(ALLOWED_LANGUAGES, { each: true })
  language?: string[];

  // ── Self-reference ────────────────────────────────────────────────────────

  /** UUID of the parent law this document amends/implements. */
  @IsOptional()
  @IsUUID()
  parent_law_id?: string;

  // ── Provenance ────────────────────────────────────────────────────────────

  @IsOptional()
  @IsUrl()
  @MaxLength(2000)
  source_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  source_attribution?: string;
}
