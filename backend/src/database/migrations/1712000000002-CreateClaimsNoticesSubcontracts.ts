import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClaimsNoticesSubcontracts1712000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Claims ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "claims" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_id" uuid NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "claim_reference" varchar(50) NOT NULL,
        "claim_type" varchar(50) NOT NULL,
        "title" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "contract_clause_references" jsonb,
        "claimed_amount" decimal(15,2),
        "claimed_time_extension_days" integer,
        "event_date" date NOT NULL,
        "status" varchar(50) NOT NULL DEFAULT 'DRAFT',
        "submitted_at" timestamptz,
        "acknowledged_at" timestamptz,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "claim_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
        "file_url" varchar(500) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "document_type" varchar(100),
        "uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "uploaded_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "claim_responses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
        "responded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "response_type" varchar(50) NOT NULL,
        "response_content" text NOT NULL,
        "counter_amount" decimal(15,2),
        "counter_time_days" integer,
        "justification" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "claim_status_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
        "changed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "previous_status" varchar(50) NOT NULL,
        "new_status" varchar(50) NOT NULL,
        "note" text,
        "changed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_claims_contract_id" ON "claims"("contract_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_claims_status" ON "claims"("status")`);

    // ─── Notices ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_id" uuid NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "notice_reference" varchar(50) NOT NULL,
        "notice_type" varchar(80) NOT NULL,
        "title" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "contract_clause_references" jsonb,
        "event_date" date NOT NULL,
        "response_required" boolean NOT NULL DEFAULT false,
        "response_deadline" date,
        "status" varchar(50) NOT NULL DEFAULT 'DRAFT',
        "submitted_at" timestamptz,
        "acknowledged_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notice_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "notice_id" uuid NOT NULL REFERENCES "notices"("id") ON DELETE CASCADE,
        "file_url" varchar(500) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "document_type" varchar(100),
        "uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "uploaded_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notice_responses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "notice_id" uuid NOT NULL REFERENCES "notices"("id") ON DELETE CASCADE,
        "responded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "response_type" varchar(50) NOT NULL,
        "response_content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notice_status_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "notice_id" uuid NOT NULL REFERENCES "notices"("id") ON DELETE CASCADE,
        "changed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "previous_status" varchar(50) NOT NULL,
        "new_status" varchar(50) NOT NULL,
        "note" text,
        "changed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notices_contract_id" ON "notices"("contract_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notices_status" ON "notices"("status")`);

    // ─── Sub-Contracts ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sub_contracts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "main_contract_id" uuid NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
        "subcontract_number" varchar(50) NOT NULL,
        "title" varchar(255) NOT NULL,
        "scope_description" text NOT NULL,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "status" varchar(50) NOT NULL DEFAULT 'DRAFT',
        "subcontractor_name" varchar(255) NOT NULL,
        "subcontractor_email" varchar(255) NOT NULL,
        "subcontractor_company" varchar(255),
        "subcontractor_contact_phone" varchar(50),
        "contract_value" decimal(15,2),
        "start_date" date,
        "end_date" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sub_contract_status_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sub_contract_id" uuid NOT NULL REFERENCES "sub_contracts"("id") ON DELETE CASCADE,
        "changed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "previous_status" varchar(50) NOT NULL,
        "new_status" varchar(50) NOT NULL,
        "note" text,
        "changed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sub_contracts_main_contract_id" ON "sub_contracts"("main_contract_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sub_contract_status_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sub_contracts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notice_status_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notice_responses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notice_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "claim_status_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "claim_responses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "claim_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "claims"`);
  }
}
