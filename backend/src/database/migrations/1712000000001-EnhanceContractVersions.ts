import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceContractVersions1712000000001 implements MigrationInterface {
  name = 'EnhanceContractVersions1712000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contract_versions"
      ADD COLUMN IF NOT EXISTS "version_label" varchar(20) NULL,
      ADD COLUMN IF NOT EXISTS "event_type" varchar(50) NULL,
      ADD COLUMN IF NOT EXISTS "event_description" varchar(500) NULL,
      ADD COLUMN IF NOT EXISTS "triggered_by" uuid NULL,
      ADD COLUMN IF NOT EXISTS "triggered_by_role" varchar(100) NULL,
      ADD COLUMN IF NOT EXISTS "counterparty_role" varchar(100) NULL,
      ADD COLUMN IF NOT EXISTS "contract_status_at_version" varchar(50) NULL,
      ADD COLUMN IF NOT EXISTS "clause_snapshot" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "is_milestone" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "contract_versions"
      ADD CONSTRAINT "FK_contract_versions_triggered_by"
      FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Backfill version_label for existing rows
    await queryRunner.query(`
      UPDATE "contract_versions"
      SET "version_label" = 'V' || version_number
      WHERE version_label IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contract_versions_contract_id"
      ON "contract_versions"("contract_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contract_versions_is_milestone"
      ON "contract_versions"("is_milestone")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contract_versions_is_milestone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contract_versions_contract_id"`);
    await queryRunner.query(`
      ALTER TABLE "contract_versions" DROP CONSTRAINT IF EXISTS "FK_contract_versions_triggered_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "contract_versions"
      DROP COLUMN IF EXISTS "version_label",
      DROP COLUMN IF EXISTS "event_type",
      DROP COLUMN IF EXISTS "event_description",
      DROP COLUMN IF EXISTS "triggered_by",
      DROP COLUMN IF EXISTS "triggered_by_role",
      DROP COLUMN IF EXISTS "counterparty_role",
      DROP COLUMN IF EXISTS "contract_status_at_version",
      DROP COLUMN IF EXISTS "clause_snapshot",
      DROP COLUMN IF EXISTS "metadata",
      DROP COLUMN IF EXISTS "is_milestone"
    `);
  }
}
