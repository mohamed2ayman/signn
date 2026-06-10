import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.27 — Migration C: Legal Sources catalogue + visual-order flag.
 *
 * Some legal-document publishers store their PDFs with Arabic in *visual*
 * order (RTL word-reversed) rather than logical order.  Unconditional
 * word-reversal in the chunker would corrupt the common (logical-order) case,
 * so direction is made an explicit per-source property:
 *
 *   - legal_sources catalogues each publisher with an is_visual_order flag.
 *   - legal_documents.source_id links a document to its source.
 *   - Uploads inherit the flag; the chunker reverses word order only when
 *     the source requires it.
 *
 * The Egyptian Tax Authority is pre-seeded as visual-order (confirmed via the
 * مادة 217 word-reversal test in Phase D).
 *
 * Pattern: CREATE TABLE/INDEX IF NOT EXISTS, DO $$ IF NOT EXISTS for the
 * constraint — never EXCEPTION WHEN (lessons #31, #103, #111).
 */
export class AddLegalSources1755000000003 implements MigrationInterface {
  name = 'AddLegalSources1755000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. legal_sources table ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_sources" (
        "id"              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "name"            VARCHAR(255) NOT NULL,
        "base_url"        VARCHAR(500) NULL,
        "jurisdiction"    VARCHAR(10)  NOT NULL,
        "is_visual_order" BOOLEAN      NOT NULL DEFAULT false,
        "notes"           TEXT         NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Unique (name, jurisdiction) to prevent duplicate source rows.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_legal_sources_name_jurisdiction"
        ON "legal_sources" ("name", "jurisdiction");
    `);

    // ── 2. source_id FK on legal_documents ─────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "legal_documents"
        ADD COLUMN IF NOT EXISTS "source_id" UUID NULL;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_legal_documents_source_id'
        ) THEN
          ALTER TABLE "legal_documents"
            ADD CONSTRAINT "fk_legal_documents_source_id"
            FOREIGN KEY ("source_id")
            REFERENCES "legal_sources"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_documents_source_id"
        ON "legal_documents" ("source_id")
        WHERE "source_id" IS NOT NULL;
    `);

    // ── 3. Seed the Egyptian Tax Authority (visual-order) ──────────────────
    // ON CONFLICT DO NOTHING keeps the migration idempotent against the
    // (name, jurisdiction) unique index.
    await queryRunner.query(`
      INSERT INTO "legal_sources"
        ("id", "name", "base_url", "jurisdiction", "is_visual_order", "notes")
      VALUES
        (gen_random_uuid(),
         'Egyptian Tax Authority',
         'eta.gov.eg',
         'EG',
         true,
         'Confirmed visual-order Arabic via مادة 217 word-reversal test')
      ON CONFLICT ("name", "jurisdiction") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_legal_documents_source_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "legal_documents"
        DROP CONSTRAINT IF EXISTS "fk_legal_documents_source_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "legal_documents" DROP COLUMN IF EXISTS "source_id";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_sources"`);
  }
}
