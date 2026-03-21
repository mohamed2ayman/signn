import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameContractorsToProjectParties1710000000001 implements MigrationInterface {
  name = 'RenameContractorsToProjectParties1710000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the party_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "party_type" AS ENUM (
          'EMPLOYER',
          'ENGINEERING_CONSULTANT',
          'DESIGN_CONSULTANT',
          'COST_CONSULTANT',
          'CONTRACTOR',
          'SUBCONTRACTOR'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 2. Rename the contractors table to project_parties
    await queryRunner.query(`ALTER TABLE "contractors" RENAME TO "project_parties"`);

    // 3. Rename the contractor_organization_id column to party_organization_id
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      RENAME COLUMN "contractor_organization_id" TO "party_organization_id"
    `);

    // 4. Add project_id column (linking parties to specific projects)
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD COLUMN "project_id" UUID
    `);

    // 5. Add party_type column with default CONTRACTOR for existing rows
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD COLUMN "party_type" "party_type" NOT NULL DEFAULT 'CONTRACTOR'
    `);

    // 6. Add permissions JSONB column for per-party permission overrides
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD COLUMN "permissions" JSONB
    `);

    // 7. Add foreign key for project_id
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD CONSTRAINT "FK_project_parties_project"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
    `);

    // 8. Rename the FK constraint for owner_organization_id
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      DROP CONSTRAINT IF EXISTS "FK_contractors_owner_org"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD CONSTRAINT "FK_project_parties_owner_org"
      FOREIGN KEY ("owner_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    // 9. Rename the FK constraint for party_organization_id
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      DROP CONSTRAINT IF EXISTS "FK_contractors_contractor_org"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_parties"
      ADD CONSTRAINT "FK_project_parties_party_org"
      FOREIGN KEY ("party_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
    `);

    // 10. Update contractor_responses table: rename contractor_id to party_id
    await queryRunner.query(`
      ALTER TABLE "contractor_responses"
      RENAME COLUMN "contractor_id" TO "party_id"
    `);

    // 11. Update FK on contractor_responses
    await queryRunner.query(`
      ALTER TABLE "contractor_responses"
      DROP CONSTRAINT IF EXISTS "FK_contractor_responses_contractor"
    `);
    await queryRunner.query(`
      ALTER TABLE "contractor_responses"
      ADD CONSTRAINT "FK_contractor_responses_party"
      FOREIGN KEY ("party_id") REFERENCES "project_parties"("id") ON DELETE CASCADE
    `);

    // 12. Update indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contractors_owner_org"`);
    await queryRunner.query(`CREATE INDEX "IDX_project_parties_owner_org" ON "project_parties" ("owner_organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_project_parties_project" ON "project_parties" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_project_parties_type" ON "project_parties" ("party_type")`);
    await queryRunner.query(`CREATE INDEX "IDX_contractor_responses_party" ON "contractor_responses" ("party_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse all changes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contractor_responses_party"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_project_parties_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_project_parties_project"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_project_parties_owner_org"`);
    await queryRunner.query(`CREATE INDEX "IDX_contractors_owner_org" ON "project_parties" ("owner_organization_id")`);

    // Revert contractor_responses
    await queryRunner.query(`ALTER TABLE "contractor_responses" DROP CONSTRAINT IF EXISTS "FK_contractor_responses_party"`);
    await queryRunner.query(`ALTER TABLE "contractor_responses" RENAME COLUMN "party_id" TO "contractor_id"`);
    await queryRunner.query(`
      ALTER TABLE "contractor_responses"
      ADD CONSTRAINT "FK_contractor_responses_contractor"
      FOREIGN KEY ("contractor_id") REFERENCES "project_parties"("id") ON DELETE CASCADE
    `);

    // Revert project_parties
    await queryRunner.query(`ALTER TABLE "project_parties" DROP CONSTRAINT IF EXISTS "FK_project_parties_party_org"`);
    await queryRunner.query(`ALTER TABLE "project_parties" DROP CONSTRAINT IF EXISTS "FK_project_parties_owner_org"`);
    await queryRunner.query(`ALTER TABLE "project_parties" DROP CONSTRAINT IF EXISTS "FK_project_parties_project"`);
    await queryRunner.query(`ALTER TABLE "project_parties" DROP COLUMN IF EXISTS "permissions"`);
    await queryRunner.query(`ALTER TABLE "project_parties" DROP COLUMN IF EXISTS "party_type"`);
    await queryRunner.query(`ALTER TABLE "project_parties" DROP COLUMN IF EXISTS "project_id"`);
    await queryRunner.query(`ALTER TABLE "project_parties" RENAME COLUMN "party_organization_id" TO "contractor_organization_id"`);
    await queryRunner.query(`ALTER TABLE "project_parties" RENAME TO "contractors"`);

    await queryRunner.query(`
      ALTER TABLE "contractors"
      ADD CONSTRAINT "FK_contractors_owner_org"
      FOREIGN KEY ("owner_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "contractors"
      ADD CONSTRAINT "FK_contractors_contractor_org"
      FOREIGN KEY ("contractor_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS "party_type"`);
  }
}
