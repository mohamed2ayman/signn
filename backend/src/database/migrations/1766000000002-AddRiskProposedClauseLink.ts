import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-tab rework — STEP 3: AI clause re-phrase (proposed replacement).
 *
 * Additive-only. Links a risk to the AI-drafted PROPOSED clause that would
 * replace its clause (the "re-phrase" suggestion). NULL until a rewrite is
 * generated; cleared again once the host applies (promote) or discards the
 * rewrite. A single risk carries at most one pending rewrite.
 *
 * The proposed clause is an `is_proposed=true` ContractClause created by a
 * NON-guest path (attributed to the AI rewrite, source = AI_DRAFTED), with
 * `source_document_id = NULL` so it stays fully isolated from the guest
 * document-scoped proposed-version machinery (getProposedClauses /
 * GuestProposedVersionsPanel filter by source_document_id).
 *
 * SAFETY: `IF NOT EXISTS`, NO backfill. FK → contract_clauses ON DELETE SET
 * NULL (guarded by a pg_constraint existence check — never EXCEPTION WHEN,
 * lesson #111). No `ALTER TYPE`, so no `transaction = false` needed.
 */
export class AddRiskProposedClauseLink1766000000002
  implements MigrationInterface
{
  name = 'AddRiskProposedClauseLink1766000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        ADD COLUMN IF NOT EXISTS "proposed_contract_clause_id" UUID NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_risk_analyses_proposed_contract_clause'
        ) THEN
          ALTER TABLE "risk_analyses"
            ADD CONSTRAINT "fk_risk_analyses_proposed_contract_clause"
            FOREIGN KEY ("proposed_contract_clause_id")
            REFERENCES "contract_clauses" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP CONSTRAINT IF EXISTS "fk_risk_analyses_proposed_contract_clause"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_analyses"
        DROP COLUMN IF EXISTS "proposed_contract_clause_id"
    `);
  }
}
