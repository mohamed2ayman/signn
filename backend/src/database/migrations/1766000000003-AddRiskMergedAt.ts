import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-tab rework — FIX 1: persistent MERGED state.
 *
 * Additive-only. Records WHEN a risk's AI re-phrase was promoted (Merge &
 * Apply) so the frontend's MERGED state survives a page reload. Set ONLY on the
 * accept path of the rephrase-apply endpoint; a reject leaves it NULL.
 *
 * SAFETY: `IF NOT EXISTS`, NO backfill. No `ALTER TYPE`, so no
 * `transaction = false` needed. Timestamp strictly greater than the largest
 * existing migration (1766000000002) per lesson #168.
 */
export class AddRiskMergedAt1766000000003 implements MigrationInterface {
  name = 'AddRiskMergedAt1766000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        ADD COLUMN IF NOT EXISTS "merged_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP COLUMN IF EXISTS "merged_at"
    `);
  }
}
