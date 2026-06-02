import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.24b — Create knowledge_asset_usages backlink table.
 *
 * Tracks which AI analysis runs (compliance checks, risk analyses, research)
 * consumed each knowledge asset.  v1 only writes COMPLIANCE_CHECK rows;
 * RISK_ANALYSIS and RESEARCH are reserved for future use.
 *
 * Design decisions:
 * - asset_id FK ON DELETE CASCADE — deleting an asset also removes its usage
 *   history (no orphaned rows).
 * - context_id is a UUID that points to the analysis row in its own table
 *   (e.g. compliance_checks.id).  No FK here because context_type varies.
 * - Two indexes: one per asset (for "Used In" backlink queries) and one per
 *   context (to find all assets used in a given analysis).
 * - No EXCEPTION WHEN blocks — CREATE IF NOT EXISTS handles idempotency
 *   (lessons #31, #103).
 * - No ALTER TYPE — no `transaction = false` needed (lesson #109 does not apply).
 */
export class CreateKnowledgeAssetUsages1751000000002 implements MigrationInterface {
  name = 'CreateKnowledgeAssetUsages1751000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS knowledge_asset_usages (
        id           UUID        NOT NULL DEFAULT gen_random_uuid(),
        asset_id     UUID        NOT NULL,
        context_type VARCHAR(50) NOT NULL,
        context_id   UUID        NOT NULL,
        used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_knowledge_asset_usages PRIMARY KEY (id),
        CONSTRAINT fk_knowledge_asset_usages_asset
          FOREIGN KEY (asset_id)
          REFERENCES knowledge_assets(id)
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_asset_usages_asset_id
        ON knowledge_asset_usages (asset_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_asset_usages_context
        ON knowledge_asset_usages (context_id, context_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS knowledge_asset_usages`);
  }
}
