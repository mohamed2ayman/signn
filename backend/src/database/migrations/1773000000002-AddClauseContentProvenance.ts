import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clause-content provenance tracking (scan-corruption guard — Fix #3, the foundation).
 *
 * Adds two columns to `clauses` so that, going forward, the raw AI-extracted
 * clause TEXT is recorded alongside any later human correction — making
 * "verbatim vs AI-reconstructed vs human-corrected" a queryable, per-clause fact.
 * This closes the content-level provenance gap: a scanned/broken-text-layer PDF
 * (e.g. Project10) is silently OCR-reconstructed by the extractor, and today NO
 * stored snapshot lets anyone tell what the AI produced vs what a human fixed.
 * Mirrors the proven clause-TYPE seam (`original_ai_clause_type` +
 * `is_type_edited_by_user`, PR #193, migration 1772000000001) applied to CONTENT.
 *
 *   - original_ai_content        : the clause text the AI first extracted (snapshot-once).
 *   - is_content_edited_by_user  : true once a human changes the content (the gold signal).
 *
 * SAFETY: strictly additive — `IF NOT EXISTS`, nullable TEXT (or NOT NULL DEFAULT
 * false for the boolean, a constant default = metadata-only, no table rewrite),
 * NO backfill (existing rows keep NULL original / false flag — nothing is claimed
 * to be human-verified). No `ALTER TYPE`, so no `transaction = false`. Timestamp
 * strictly greater than the largest existing migration (1773000000001) per lesson
 * #168. Reversible (down drops the two columns + the index). Behaviour is
 * byte-unchanged: clause `content` output is identical; only new columns are added.
 */
export class AddClauseContentProvenance1773000000002 implements MigrationInterface {
  name = 'AddClauseContentProvenance1773000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN IF NOT EXISTS "original_ai_content" TEXT
    `);
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN IF NOT EXISTS "is_content_edited_by_user" BOOLEAN NOT NULL DEFAULT false
    `);
    // Partial index — an audit/retrain export queries the (rare) human-corrected
    // rows; index only those so the common scan stays cheap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_clauses_content_edited"
        ON "clauses" ("is_content_edited_by_user") WHERE "is_content_edited_by_user" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_clauses_content_edited"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP COLUMN IF EXISTS "is_content_edited_by_user"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP COLUMN IF EXISTS "original_ai_content"`);
  }
}
