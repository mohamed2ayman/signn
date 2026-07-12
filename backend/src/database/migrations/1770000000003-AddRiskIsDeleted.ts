import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-tab clutter reduction — STEP 1: soft-delete infrastructure.
 *
 * Additive-only. Adds `is_deleted` to `risk_analyses` so a redundant duplicate
 * risk can be flagged out of every read (Risk tab, counts, summary, export)
 * WITHOUT hard-deleting the row — the row is kept (reversible; FK references
 * from `risk_analysis_override_log` and any AI-rephrase proposal link stay
 * intact) and simply excluded from reads.
 *
 * SAFETY: `IF NOT EXISTS`, NO backfill (all existing rows stay is_deleted=false
 * — nothing is hidden until an explicit, confirmed set is flagged). No
 * `ALTER TYPE`, so no `transaction = false`. Timestamp strictly greater than
 * the largest existing migration (1770000000002) per lesson #168.
 */
export class AddRiskIsDeleted1770000000003 implements MigrationInterface {
  name = 'AddRiskIsDeleted1770000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false
    `);
    // Partial index — reads filter is_deleted=false; index only the (rare)
    // flagged rows so the common "not deleted" scan stays cheap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_risk_analyses_is_deleted"
        ON "risk_analyses" ("is_deleted") WHERE "is_deleted" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_risk_analyses_is_deleted"`);
    await queryRunner.query(`
      ALTER TABLE "risk_analyses" DROP COLUMN IF EXISTS "is_deleted"
    `);
  }
}
