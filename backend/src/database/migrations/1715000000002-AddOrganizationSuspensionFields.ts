import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds suspension tracking columns to organizations so SYSTEM_ADMINs
 * can gate tenant access from the Admin Portal.
 *
 *   is_suspended      : boolean NOT NULL DEFAULT false
 *   suspension_reason : varchar(1000) NULL
 *   suspended_at      : timestamptz NULL
 */
export class AddOrganizationSuspensionFields1715000000002
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "is_suspended"      BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "suspension_reason" VARCHAR(1000) NULL,
        ADD COLUMN IF NOT EXISTS "suspended_at"      TIMESTAMPTZ   NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_organizations_is_suspended"
        ON "organizations" ("is_suspended")
        WHERE "is_suspended" = TRUE;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_organizations_is_suspended";`,
    );
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "suspended_at",
        DROP COLUMN IF EXISTS "suspension_reason",
        DROP COLUMN IF EXISTS "is_suspended";
    `);
  }
}
