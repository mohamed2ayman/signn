import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocuSignFields1711000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contracts"
      ADD COLUMN IF NOT EXISTS "docusign_envelope_id" varchar(100) NULL,
      ADD COLUMN IF NOT EXISTS "signature_status" varchar(30) NULL,
      ADD COLUMN IF NOT EXISTS "signature_signers" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "executed_at" timestamptz NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contracts_envelope_id"
      ON "contracts" ("docusign_envelope_id")
      WHERE "docusign_envelope_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contracts_envelope_id"`);
    await queryRunner.query(`
      ALTER TABLE "contracts"
      DROP COLUMN IF EXISTS "docusign_envelope_id",
      DROP COLUMN IF EXISTS "signature_status",
      DROP COLUMN IF EXISTS "signature_signers",
      DROP COLUMN IF EXISTS "executed_at"
    `);
  }
}
