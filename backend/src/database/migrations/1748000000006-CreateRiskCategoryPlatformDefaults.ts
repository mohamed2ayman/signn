import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, S.2
 *
 * Creates the `risk_category_platform_defaults` table — SIGN's research-
 * backed default L,I values per risk category (with optional jurisdiction
 * variant). Each row carries an APA citation (short + full) and an
 * optional FK to the platform-owned KnowledgeAsset where the source
 * document lives. Used by the B.1 resolver's step 3 (PLATFORM_DEFAULT)
 * and rendered as citation text in the F.1 explanation popover.
 *
 * Also adds the deferred FK from `risk_analyses.platform_default_ref_id`
 * (column added in S.1) → `risk_category_platform_defaults.id`.
 *
 * Uniqueness rule: `(risk_category, jurisdiction_variant)` must be
 * unique — one default per category per jurisdiction. Because
 * `jurisdiction_variant` is NULLable, we use PostgreSQL 15's
 * `NULLS NOT DISTINCT` clause so multiple NULL-jurisdiction rows for
 * the same category are rejected (the codebase runs PG 15.17).
 *
 * Idempotent + reversible. Round-trip is data-lossless before B.6 +
 * A.3 seed run.
 */
export class CreateRiskCategoryPlatformDefaults1748000000006
  implements MigrationInterface
{
  name = 'CreateRiskCategoryPlatformDefaults1748000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Create the table ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_category_platform_defaults (
        id                    UUID         NOT NULL DEFAULT uuid_generate_v4(),
        risk_category         VARCHAR(100) NOT NULL,
        default_likelihood    SMALLINT     NOT NULL,
        default_impact        SMALLINT     NOT NULL,
        apa_citation_short    VARCHAR(255) NOT NULL,
        apa_citation_full     TEXT         NOT NULL,
        knowledge_asset_id    UUID         NULL,
        reasoning             TEXT         NULL,
        jurisdiction_variant  VARCHAR(20)  NULL,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        CONSTRAINT pk_risk_category_platform_defaults
          PRIMARY KEY (id),

        CONSTRAINT ck_risk_category_platform_defaults_likelihood
          CHECK (default_likelihood BETWEEN 1 AND 5),

        CONSTRAINT ck_risk_category_platform_defaults_impact
          CHECK (default_impact BETWEEN 1 AND 5),

        CONSTRAINT fk_risk_category_platform_defaults_knowledge_asset
          FOREIGN KEY (knowledge_asset_id)
          REFERENCES knowledge_assets (id)
          ON DELETE SET NULL
      );
    `);

    // ── 2. Unique index: one default per (category, jurisdiction) ────────
    // NULLS NOT DISTINCT (PG 15+) treats NULL as a regular value for
    // uniqueness — rejects multiple (category, NULL) rows.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_category_platform_defaults_cat_jurisdiction
        ON risk_category_platform_defaults (risk_category, jurisdiction_variant)
        NULLS NOT DISTINCT;
    `);

    // ── 3. Deferred FK from S.1 ──────────────────────────────────────────
    // S.1's risk_analyses.platform_default_ref_id was added as a nullable
    // UUID without a FK constraint (the target table didn't exist yet).
    // Now that we've created the target table, add the FK.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_risk_analyses_platform_default_ref'
        ) THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT fk_risk_analyses_platform_default_ref
              FOREIGN KEY (platform_default_ref_id)
              REFERENCES risk_category_platform_defaults (id)
              ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the FK from risk_analyses FIRST, before dropping the table it
    // references — otherwise the DROP TABLE would fail on the FK.
    await queryRunner.query(`
      ALTER TABLE risk_analyses
        DROP CONSTRAINT IF EXISTS fk_risk_analyses_platform_default_ref;
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_risk_category_platform_defaults_cat_jurisdiction;
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS risk_category_platform_defaults;`,
    );
  }
}
