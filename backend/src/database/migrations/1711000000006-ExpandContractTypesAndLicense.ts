import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandContractTypesAndLicense1711000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Convert contract_type from enum to varchar to support the expanded list
    // First, create a temporary column, copy data, drop old column, rename
    await queryRunner.query(`
      ALTER TABLE "contracts"
      ADD COLUMN "contract_type_new" varchar(50)
    `);

    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type_new" = "contract_type"::text
    `);

    // Map old enum values to new ones
    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type_new" = 'FIDIC_RED_BOOK_1999'
      WHERE "contract_type_new" = 'FIDIC_RED'
    `);

    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type_new" = 'FIDIC_YELLOW_BOOK_1999'
      WHERE "contract_type_new" = 'FIDIC_YELLOW'
    `);

    await queryRunner.query(`
      ALTER TABLE "contracts" DROP COLUMN "contract_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "contracts"
      RENAME COLUMN "contract_type_new" TO "contract_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "contracts"
      ALTER COLUMN "contract_type" SET NOT NULL
    `);

    // Drop the old enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "contract_type_enum"`);

    // Step 2: Add license columns
    await queryRunner.query(`
      ALTER TABLE "contracts"
      ADD COLUMN IF NOT EXISTS "license_acknowledged" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "license_organization" varchar(20) NULL
    `);

    // Step 3: Add content column to knowledge_assets for storing clause structures
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
      ADD COLUMN IF NOT EXISTS "content" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove content column from knowledge_assets
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
      DROP COLUMN IF EXISTS "content"
    `);

    // Remove license columns
    await queryRunner.query(`
      ALTER TABLE "contracts"
      DROP COLUMN IF EXISTS "license_acknowledged",
      DROP COLUMN IF EXISTS "license_organization"
    `);

    // Recreate old enum and convert back
    await queryRunner.query(`
      CREATE TYPE "contract_type_enum" AS ENUM ('FIDIC_RED', 'FIDIC_YELLOW', 'ADHOC', 'UPLOADED')
    `);

    // Map new values back to old ones
    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type" = 'FIDIC_RED'
      WHERE "contract_type" LIKE 'FIDIC_RED%'
    `);

    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type" = 'FIDIC_YELLOW'
      WHERE "contract_type" LIKE 'FIDIC_YELLOW%' OR "contract_type" LIKE 'FIDIC_SILVER%'
        OR "contract_type" LIKE 'FIDIC_%'
    `);

    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type" = 'ADHOC'
      WHERE "contract_type" NOT IN ('FIDIC_RED', 'FIDIC_YELLOW', 'UPLOADED')
        AND "contract_type" != 'ADHOC'
    `);

    await queryRunner.query(`
      ALTER TABLE "contracts"
      ADD COLUMN "contract_type_old" "contract_type_enum"
    `);

    await queryRunner.query(`
      UPDATE "contracts"
      SET "contract_type_old" = "contract_type"::"contract_type_enum"
    `);

    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "contract_type"`);
    await queryRunner.query(`ALTER TABLE "contracts" RENAME COLUMN "contract_type_old" TO "contract_type"`);
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "contract_type" SET NOT NULL`);
  }
}
