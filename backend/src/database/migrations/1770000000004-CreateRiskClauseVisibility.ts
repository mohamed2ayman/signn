import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-tab clutter reduction — STEP 3: swap persistence.
 *
 * The Risk tab shows the top-2 risks per clause by default (severity + distinct)
 * and collapses the rest under "Show more". A human can SWAP a hidden risk into
 * the visible top-2. That choice must survive reload AND be knowable server-side
 * (completeness + gold export count/tag by the VISIBLE set — STEP 4). So the
 * per-clause chosen visible set is persisted GLOBALLY per clause (one canonical
 * visible set per clause for the shared annotation corpus / export), keyed by
 * the contract_clause junction.
 *
 * No row for a clause ⇒ the deterministic default top-2 applies. A row overrides
 * it with exactly the 2 chosen visible risk ids.
 *
 * Additive-only, IF NOT EXISTS, no backfill. FK to contract_clauses CASCADE (if
 * the clause goes, its visibility pref goes). Timestamp strictly greater than
 * 1770000000003.
 */
export class CreateRiskClauseVisibility1770000000004 implements MigrationInterface {
  name = 'CreateRiskClauseVisibility1770000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "risk_clause_visibility" (
        "contract_clause_id" uuid PRIMARY KEY,
        "visible_risk_ids"   uuid[] NOT NULL,
        "updated_by"         uuid NULL,
        "updated_at"         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rcv_contract_clause') THEN
          ALTER TABLE "risk_clause_visibility"
            ADD CONSTRAINT "fk_rcv_contract_clause"
            FOREIGN KEY ("contract_clause_id") REFERENCES "contract_clauses" ("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rcv_updated_by') THEN
          ALTER TABLE "risk_clause_visibility"
            ADD CONSTRAINT "fk_rcv_updated_by"
            FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_clause_visibility"`);
  }
}
