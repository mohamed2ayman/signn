import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the payment_transactions table used by the Billing & Payments
 * admin page. Each row is a record of a Paymob (or future gateway)
 * payment attempt against an organization's subscription plan.
 */
export class CreatePaymentTransactions1715000000004
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_transactions" (
        "id"                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organization_id"       UUID          NOT NULL,
        "paymob_transaction_id" VARCHAR(255)  NULL,
        "amount"                DECIMAL(10,2) NOT NULL,
        "currency"              VARCHAR(10)   NOT NULL,
        "status"                VARCHAR(20)   NOT NULL,
        "plan_id"               UUID          NULL,
        "plan_name"             VARCHAR(255)  NULL,
        "webhook_payload"       JSONB         NULL,
        "created_at"            TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payment_transactions_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_transactions_org_id"
        ON "payment_transactions" ("organization_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_transactions_status"
        ON "payment_transactions" ("status");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_transactions_created_at"
        ON "payment_transactions" ("created_at" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_transactions_created_at";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_transactions_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_transactions_org_id";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_transactions";`);
  }
}
