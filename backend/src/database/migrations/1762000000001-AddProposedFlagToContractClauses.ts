import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest extraction completion (Slice 1) — Option C "proposed clause" segregation.
 *
 * When a bound GUEST uploads a new contract version and its AI extraction
 * completes, the extracted clauses must NOT be appended into the host's LIVE
 * clause set: `createClausesFromExtraction` numbers `order_index` from 0 per
 * document, so a second pile of clauses on the same contract would produce
 * duplicate ordinals and corrupt the host's `ORDER BY order_index` read (the
 * latent #4 defect).
 *
 * Fix: write the guest's clauses as a SEPARATE "proposed" set, flagged on the
 * `contract_clauses` junction (which is the row that carries `order_index` and
 * is what every clause read joins + sorts through). Every DEFAULT read (the
 * host's canonical Clauses view, the guest viewer's clause read, the managing
 * review screen) EXCLUDES `is_proposed = true`, so the proposed pile never
 * mixes into the host's live ordering — collision eliminated by segregation.
 * Proposed clauses surface ONLY via the explicit host-v1 "proposed clauses"
 * read (filtered by `is_proposed = true` + the guest upload's
 * `source_document_id`).
 *
 * FAIL-OPEN default `false`: every existing junction row is a host/original
 * clause and stays in the canonical view (never hidden). Only the guest
 * write-back sets `true`. (Postgres 11+ applies a constant default as metadata
 * only — no table rewrite.)
 *
 * The partial index backs the host-v1 read (`WHERE is_proposed = true` scoped
 * to a contract) without bloating the hot all-clauses path.
 */
export class AddProposedFlagToContractClauses1762000000001
  implements MigrationInterface
{
  name = 'AddProposedFlagToContractClauses1762000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contract_clauses"
      ADD COLUMN IF NOT EXISTS "is_proposed" boolean NOT NULL DEFAULT false
    `);

    // Partial index for the host-v1 "proposed clauses" read. Only proposed
    // rows are indexed, so the dominant all-clauses host read is untouched.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contract_clauses_proposed"
      ON "contract_clauses" ("contract_id")
      WHERE "is_proposed" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_contract_clauses_proposed"
    `);
    await queryRunner.query(`
      ALTER TABLE "contract_clauses" DROP COLUMN IF EXISTS "is_proposed"
    `);
  }
}
