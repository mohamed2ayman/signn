import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractApprovers1713000000001 implements MigrationInterface {
  name = 'AddContractApprovers1713000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the approver status enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "approver_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create the contract_approvers join table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contract_approvers" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "user_id"     UUID NOT NULL,
        "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "approved_at" TIMESTAMPTZ NULL,
        "status"      "approver_status_enum" NOT NULL DEFAULT 'PENDING',
        "comment"     TEXT NULL,
        CONSTRAINT "PK_contract_approvers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contract_approvers_contract"
          FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contract_approvers_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    // Index for fast lookups by contract and by user
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contract_approvers_contract_id"
        ON "contract_approvers" ("contract_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contract_approvers_user_id"
        ON "contract_approvers" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_approvers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "approver_status_enum"`);
  }
}
