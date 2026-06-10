import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.27 — Migration D: force_ocr per legal source.
 *
 * Some publishers (the Egyptian Tax Authority) embed CID TrueType font subsets
 * with a BROKEN ToUnicode CMap that maps the kaf glyph to U+0622 (آ).  Every
 * text-layer extractor inherits that corruption (~72% of chunks); it is lossy
 * and non-invertible (see docs/7-27-character-mapping/00-findings.md).  The only
 * clean path is OCR @ 300dpi, which reads pixels and bypasses the text layer.
 *
 * `force_ocr` makes that an explicit per-source property.  Because OCR emits
 * Arabic in LOGICAL order natively, an OCR'd source must NOT also have its words
 * reversed — so the ETA row's is_visual_order is flipped to false here (the
 * reversal was only needed for the corrupt text-layer path we're abandoning).
 */
export class AddForceOcrToLegalSources1755000000004 implements MigrationInterface {
  name = 'AddForceOcrToLegalSources1755000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "legal_sources"
        ADD COLUMN IF NOT EXISTS "force_ocr" BOOLEAN NOT NULL DEFAULT false;
    `);

    // ETA: switch to OCR; OCR is logical-order, so disable bidi reversal.
    await queryRunner.query(`
      UPDATE "legal_sources"
         SET "force_ocr"       = true,
             "is_visual_order" = false,
             "notes"           = 'ETA fonts have broken ToUnicode CMap (kaf→آ corruption). Force OCR @ 300dpi; suppresses bidi reversal since OCR emits logical order.'
       WHERE "name" = 'Egyptian Tax Authority';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert ETA to the pre-D state (visual-order text-layer path).
    await queryRunner.query(`
      UPDATE "legal_sources"
         SET "is_visual_order" = true,
             "notes"           = 'Confirmed visual-order Arabic via مادة 217 word-reversal test'
       WHERE "name" = 'Egyptian Tax Authority';
    `);
    await queryRunner.query(`
      ALTER TABLE "legal_sources" DROP COLUMN IF EXISTS "force_ocr";
    `);
  }
}
