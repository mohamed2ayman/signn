import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clause-type correction tracking + provider source (Step 2 — retrain logging).
 *
 * Adds three columns to `clauses` so that, going forward, every AI-assigned
 * clause type is recorded alongside any later human correction — giving a
 * queryable (AI-label vs human-label) corpus for a future clause-type model
 * retrain/eval, WITHOUT changing today's behavior. Mirrors the proven
 * risk-annotation pattern (`risk_analyses.is_edited_by_user` +
 * `original_risk_category`, PR #130).
 *
 *   - original_ai_clause_type : the type the AI first assigned (snapshot-once).
 *   - is_type_edited_by_user  : true once a human changes the type (the gold signal).
 *   - clause_type_source      : which provider produced the type ('sonnet-inline' today).
 *
 * SAFETY: strictly additive — `IF NOT EXISTS`, nullable (or NOT NULL DEFAULT
 * false for the boolean, a constant default = metadata-only, no table rewrite),
 * NO backfill (existing rows keep NULL original / false flag — nothing is
 * claimed to be human-verified). No `ALTER TYPE`, so no `transaction = false`.
 * Timestamp strictly greater than the largest existing migration (1771000000001)
 * per lesson #168. Reversible (down drops the three columns + the index).
 */
export class AddClauseTypeTracking1772000000001 implements MigrationInterface {
  name = 'AddClauseTypeTracking1772000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN IF NOT EXISTS "original_ai_clause_type" VARCHAR(100)
    `);
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN IF NOT EXISTS "is_type_edited_by_user" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN IF NOT EXISTS "clause_type_source" VARCHAR(50)
    `);
    // Partial index — the retrain export queries the (rare) human-corrected rows;
    // index only those so the common scan stays cheap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_clauses_type_edited"
        ON "clauses" ("is_type_edited_by_user") WHERE "is_type_edited_by_user" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_clauses_type_edited"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP COLUMN IF EXISTS "clause_type_source"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP COLUMN IF EXISTS "is_type_edited_by_user"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP COLUMN IF EXISTS "original_ai_clause_type"`);
  }
}
