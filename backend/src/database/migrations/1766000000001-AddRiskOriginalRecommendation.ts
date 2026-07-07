import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-tab rework — STEP 2: editable recommendation tracking.
 *
 * Additive-only. Adds `original_recommendation` to `risk_analyses` so a human
 * correction of the AI-drafted recommendation text preserves the ORIGINAL AI
 * value before the first edit — the same original-vs-corrected training signal
 * as `original_risk_level` / `original_risk_category` (migration
 * 1764000000001, PR #130).
 *
 * SAFETY: `IF NOT EXISTS`, NO backfill / UPDATE — existing rows are untouched
 * (`original_recommendation` stays NULL until the first edit). No `ALTER TYPE`,
 * so no `transaction = false` needed. `text` matches the `recommendation`
 * column type.
 */
export class AddRiskOriginalRecommendation1766000000001
  implements MigrationInterface
{
  name = 'AddRiskOriginalRecommendation1766000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        ADD COLUMN IF NOT EXISTS "original_recommendation" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP COLUMN IF EXISTS "original_recommendation"
    `);
  }
}
