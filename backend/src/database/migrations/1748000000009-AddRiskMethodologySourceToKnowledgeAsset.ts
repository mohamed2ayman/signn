import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, S.5
 *
 * Extends `knowledge_assets` with two columns enabling user-flagged risk
 * methodology references (resolver step 1, B.1):
 *
 *   is_risk_methodology_source BOOLEAN NOT NULL DEFAULT FALSE
 *     — when TRUE, this asset's `content.risk_methodology` jsonb block
 *       provides authoritative L,I defaults for `risk_methodology_category`
 *       (or for any category when that field is NULL).
 *
 *   risk_methodology_category  VARCHAR(100) NULL
 *     — optional category match. NULL = generic fallback. When set,
 *       application-layer validation in B.2 checks this matches a row in
 *       `risk_categories.name WHERE is_active = TRUE`. No DB FK in v1
 *       (matches the existing RiskAnalysis.risk_category varchar pattern).
 *
 * Per operator Decision 1: NO `is_platform_owned` column. The existing
 * convention `organization_id IS NULL AND source = 'PLATFORM_SEED'`
 * already signals platform-owned content.
 *
 * Per operator Decision 5: shape of `content.risk_methodology` is
 * enforced at the application layer (B.2 reader validates on read), NOT
 * via a DB CHECK constraint on the jsonb. This allows the common
 * workflow of editing content first, then flagging the asset later.
 *
 * Partial index on the lookup path: only rows with
 * `is_risk_methodology_source = TRUE` matter for the resolver's step 1
 * query. Partial index is much smaller than a full one because the vast
 * majority of KB assets will never be flagged.
 *
 * Idempotent + reversible.
 */
export class AddRiskMethodologySourceToKnowledgeAsset1748000000009
  implements MigrationInterface
{
  name = 'AddRiskMethodologySourceToKnowledgeAsset1748000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE knowledge_assets
        ADD COLUMN IF NOT EXISTS is_risk_methodology_source BOOLEAN      NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS risk_methodology_category  VARCHAR(100) NULL;
    `);

    // Partial index supporting the B.1 resolver's step 1 query:
    //   WHERE organization_id = :org
    //     AND is_risk_methodology_source = TRUE
    //     AND (risk_methodology_category = :cat OR risk_methodology_category IS NULL)
    // The partial filter on `is_risk_methodology_source = TRUE` keeps the
    // index tiny because the vast majority of KB assets are never flagged.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_assets_risk_methodology
        ON knowledge_assets (organization_id, risk_methodology_category)
        WHERE is_risk_methodology_source = TRUE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_knowledge_assets_risk_methodology;
    `);
    await queryRunner.query(`
      ALTER TABLE knowledge_assets
        DROP COLUMN IF EXISTS risk_methodology_category,
        DROP COLUMN IF EXISTS is_risk_methodology_source;
    `);
  }
}
