import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfaEnhancements1712000000004 implements MigrationInterface {
  name = 'AddMfaEnhancements1712000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add mfa_method column to users
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "mfa_method" VARCHAR(10) NULL
    `);

    // Add mfa_totp_secret column to users
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "mfa_totp_secret" VARCHAR(255) NULL
    `);

    // Add mfa_recovery_codes column to users
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "mfa_recovery_codes" JSONB NULL
    `);

    // Add require_mfa column to subscription_plans
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
      ADD COLUMN IF NOT EXISTS "require_mfa" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_totp_secret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_recovery_codes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "require_mfa"`,
    );
  }
}
