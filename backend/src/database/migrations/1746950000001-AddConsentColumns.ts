import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 — Legal & Policy Layer
 *
 * Idempotent migration adding consent + communication-preference columns to
 * `users`. Records when each user accepted the Terms, Privacy Policy, and
 * Acceptable Use Policy at registration, and tracks cookie consent +
 * marketing / AI-training opt-ins.
 *
 * Note: `email_digest_opt_out` was already added by
 * 1718000000002-AddComplianceMonitoring; we do NOT re-add it here.
 */
export class AddConsentColumns1746950000001 implements MigrationInterface {
  name = 'AddConsentColumns1746950000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS accepted_terms_at           TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS accepted_privacy_policy_at  TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS accepted_aup_at             TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS terms_version               VARCHAR(20)  NULL DEFAULT '1.0',
        ADD COLUMN IF NOT EXISTS cookie_consent_given_at     TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS cookie_consent_version      VARCHAR(20)  NULL,
        ADD COLUMN IF NOT EXISTS marketing_email_opt_in      BOOLEAN      NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ai_training_opt_in          BOOLEAN      NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS accepted_terms_at,
        DROP COLUMN IF EXISTS accepted_privacy_policy_at,
        DROP COLUMN IF EXISTS accepted_aup_at,
        DROP COLUMN IF EXISTS terms_version,
        DROP COLUMN IF EXISTS cookie_consent_given_at,
        DROP COLUMN IF EXISTS cookie_consent_version,
        DROP COLUMN IF EXISTS marketing_email_opt_in,
        DROP COLUMN IF EXISTS ai_training_opt_in;
    `);
  }
}
