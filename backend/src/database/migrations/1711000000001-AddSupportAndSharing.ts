import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupportAndSharing1711000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Support ticket replies table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_ticket_replies" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "content" text NOT NULL,
        "is_internal_note" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_support_ticket_replies_ticket" ON "support_ticket_replies" ("ticket_id")`,
    );

    // Contract shares table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contract_shares" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "contract_id" uuid NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
        "shared_by" uuid NOT NULL REFERENCES "users"("id"),
        "shared_with_email" varchar(255) NOT NULL,
        "permission" varchar(20) NOT NULL DEFAULT 'view',
        "token" varchar(255) UNIQUE NOT NULL,
        "expires_at" timestamptz,
        "accessed_at" timestamptz,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_shares_token" ON "contract_shares" ("token")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_shares_contract" ON "contract_shares" ("contract_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_shares"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_replies"`);
  }
}
