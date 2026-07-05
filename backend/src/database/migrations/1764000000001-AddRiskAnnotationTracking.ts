import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 8.3 — Risk annotation tracking (editable Risk Analysis tab).
 *
 * Additive-only. Adds human-edit tracking + AI-original capture to
 * `risk_analyses` so a human correction of `risk_level` / `risk_category`
 * preserves the ORIGINAL AI value before the first edit — the
 * original-vs-corrected training signal for Phase 8.3.
 *
 * SAFETY: every column is `IF NOT EXISTS`; there is NO backfill / UPDATE —
 * the existing 1,061 AI pre-labeled rows are untouched
 * (`is_edited_by_user` defaults false; `edited_*` + `original_*` stay NULL).
 * No `ALTER TYPE`, so no `transaction = false` needed. The FK is guarded by
 * a `pg_constraint` existence check (never `EXCEPTION WHEN` — lesson #111).
 */
export class AddRiskAnnotationTracking1764000000001
  implements MigrationInterface
{
  name = 'AddRiskAnnotationTracking1764000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        ADD COLUMN IF NOT EXISTS "is_edited_by_user"      BOOLEAN      NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "edited_by_user_id"      UUID         NULL,
        ADD COLUMN IF NOT EXISTS "edited_at"              TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS "original_risk_level"    VARCHAR(10)  NULL,
        ADD COLUMN IF NOT EXISTS "original_risk_category" VARCHAR(100) NULL
    `);

    // PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS — guard with a
    // pg_constraint existence check (never EXCEPTION WHEN — lesson #111).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_risk_analyses_edited_by_user'
        ) THEN
          ALTER TABLE "risk_analyses"
            ADD CONSTRAINT "fk_risk_analyses_edited_by_user"
            FOREIGN KEY ("edited_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP CONSTRAINT IF EXISTS "fk_risk_analyses_edited_by_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP COLUMN IF EXISTS "is_edited_by_user",
        DROP COLUMN IF EXISTS "edited_by_user_id",
        DROP COLUMN IF EXISTS "edited_at",
        DROP COLUMN IF EXISTS "original_risk_level",
        DROP COLUMN IF EXISTS "original_risk_category"
    `);
  }
}
