import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the negotiation_events table for tracking clause-level negotiation
 * activity from both the Word Add-in and the SIGN web app. Feeds the future
 * "what did we previously agree to for X clauses?" view.
 */
export class CreateNegotiationEvents1716000000001
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "negotiation_event_type_enum" AS ENUM (
          'CLAUSE_FLAGGED',
          'CLAUSE_REPLACED',
          'CLAUSE_ACCEPTED',
          'CLAUSE_REJECTED',
          'AI_SUGGESTION_APPLIED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "negotiation_event_source_enum" AS ENUM (
          'WORD_ADDIN',
          'WEB_APP'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "negotiation_events" (
        "id"             UUID                              PRIMARY KEY DEFAULT uuid_generate_v4(),
        "contract_id"    UUID                              NOT NULL,
        "clause_ref"     VARCHAR(255)                      NOT NULL,
        "event_type"     "negotiation_event_type_enum"     NOT NULL,
        "original_text"  TEXT                              NULL,
        "new_text"       TEXT                              NULL,
        "performed_by"   UUID                              NOT NULL,
        "source"         "negotiation_event_source_enum"   NOT NULL,
        "created_at"     TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        CONSTRAINT "fk_negotiation_events_contract"
          FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_negotiation_events_user"
          FOREIGN KEY ("performed_by") REFERENCES "users"("id")
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_contract_clause"
        ON "negotiation_events" ("contract_id", "clause_ref");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_events_created_at"
        ON "negotiation_events" ("created_at" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_negotiation_events_created_at";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_negotiation_contract_clause";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "negotiation_events";`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "negotiation_event_source_enum";`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "negotiation_event_type_enum";`,
    );
  }
}
