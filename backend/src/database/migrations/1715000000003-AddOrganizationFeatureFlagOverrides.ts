import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-organization feature flag overrides. The JSON object maps
 * feature-flag keys (e.g. "ai_chat", "risk_analysis") to booleans that
 * override the subscription plan's default.
 */
export class AddOrganizationFeatureFlagOverrides1715000000003
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "feature_flag_overrides" JSONB NULL DEFAULT '{}'::jsonb;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "feature_flag_overrides";
    `);
  }
}
