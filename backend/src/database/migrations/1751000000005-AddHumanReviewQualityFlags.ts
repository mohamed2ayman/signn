import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.25 — Poor Scan Quality Handling
 *
 * Two changes:
 *
 * 1. Add HUMAN_REVIEW_RECOMMENDED to the document_processing_status enum.
 *    This value is set when the OCR pipeline detects a low-quality scan
 *    (blurry, low-contrast, or skewed pages).  It is a terminal state from
 *    the pipeline's perspective — the user must re-upload or force-continue.
 *
 *    ALTER TYPE ADD VALUE cannot run inside a transaction block on PostgreSQL
 *    < 14, so transaction = false is required (same pattern as
 *    1748000000004-FixObligationStatusEnum.ts — lesson #109).
 *
 * 2. Add quality_flags VARCHAR[] NULL column to document_uploads.
 *    Stores the raw flag strings produced by TesseractTextExtractor._assess_quality,
 *    e.g. ["blur:32.1", "contrast:15.4", "rotation:12"].  NULL when no quality
 *    check was needed (digital PDFs, DOCX, etc.).
 */
export class AddHumanReviewQualityFlags1751000000005 implements MigrationInterface {
  name = 'AddHumanReviewQualityFlags1751000000005';

  // Must be false — ALTER TYPE ADD VALUE cannot run inside a transaction
  // block on PostgreSQL < 14. Set explicitly for cross-version portability.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend the enum — IF NOT EXISTS is safe on both patched and fresh DBs.
    //    TypeORM auto-generates the type name as <column_enum>_enum, so the
    //    PostgreSQL type is document_processing_status_enum (with _enum suffix).
    await queryRunner.query(
      `ALTER TYPE document_processing_status_enum ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW_RECOMMENDED'`,
    );

    // 2. Add quality_flags column (array of VARCHAR).
    //    ADD COLUMN IF NOT EXISTS keeps the migration idempotent.
    await queryRunner.query(
      `ALTER TABLE document_uploads ADD COLUMN IF NOT EXISTS quality_flags VARCHAR[] NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values once added — no-op.
    // The quality_flags column can be safely dropped.
    await queryRunner.query(
      `ALTER TABLE document_uploads DROP COLUMN IF EXISTS quality_flags`,
    );
  }
}
