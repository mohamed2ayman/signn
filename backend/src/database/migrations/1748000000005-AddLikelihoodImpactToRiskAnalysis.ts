import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, S.1
 *
 * Adds the PMBOK 5×5 qualitative-scoring columns to `risk_analyses`:
 *
 *   likelihood              SMALLINT NOT NULL DEFAULT 3   (CHECK 1-5)
 *   impact                  SMALLINT NOT NULL DEFAULT 3   (CHECK 1-5)
 *   risk_score              SMALLINT NOT NULL DEFAULT 9   (= 3 × 3; recomputed
 *                                                          by @BeforeInsert /
 *                                                          @BeforeUpdate hooks
 *                                                          on the RiskAnalysis
 *                                                          entity on every save)
 *   likelihood_source       VARCHAR(20) NOT NULL DEFAULT 'FALLBACK'
 *                                                          (CHECK in {USER_KB_REFERENCE,
 *                                                                     ORG_LEARNED,
 *                                                                     PLATFORM_DEFAULT,
 *                                                                     USER_OVERRIDE,
 *                                                                     FALLBACK})
 *   impact_source           VARCHAR(20) NOT NULL DEFAULT 'FALLBACK'  (same CHECK)
 *   last_overridden_by      UUID NULL  FK → users(id) ON DELETE SET NULL
 *   last_overridden_at      TIMESTAMPTZ NULL
 *   platform_default_ref_id UUID NULL  (FK added in S.2 once target table exists)
 *
 * Plus index:
 *   idx_risk_analyses_score (risk_score DESC) — sorting/filtering portfolio
 *   queries by severity.
 *
 * Idempotent: all ADD COLUMN / CREATE INDEX use IF NOT EXISTS, CHECK / FK
 * constraints use the DO $$ ... pg_constraint check $$ pattern.
 *
 * Reversible: down() drops the index, constraints, then columns in reverse order.
 * Round-trip is data-lossless ONLY before B.6 backfill runs.
 */
export class AddLikelihoodImpactToRiskAnalysis1748000000005
  implements MigrationInterface
{
  name = 'AddLikelihoodImpactToRiskAnalysis1748000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Add the 8 columns ─────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE risk_analyses
        ADD COLUMN IF NOT EXISTS likelihood              SMALLINT     NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS impact                  SMALLINT     NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS risk_score              SMALLINT     NOT NULL DEFAULT 9,
        ADD COLUMN IF NOT EXISTS likelihood_source       VARCHAR(20)  NOT NULL DEFAULT 'FALLBACK',
        ADD COLUMN IF NOT EXISTS impact_source           VARCHAR(20)  NOT NULL DEFAULT 'FALLBACK',
        ADD COLUMN IF NOT EXISTS last_overridden_by      UUID         NULL,
        ADD COLUMN IF NOT EXISTS last_overridden_at      TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS platform_default_ref_id UUID         NULL;
    `);

    // ── 2. CHECK constraints (PG has no ADD CONSTRAINT IF NOT EXISTS) ────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_risk_analyses_likelihood_range') THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT ck_risk_analyses_likelihood_range
              CHECK (likelihood BETWEEN 1 AND 5);
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_risk_analyses_impact_range') THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT ck_risk_analyses_impact_range
              CHECK (impact BETWEEN 1 AND 5);
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_risk_analyses_likelihood_source') THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT ck_risk_analyses_likelihood_source
              CHECK (likelihood_source IN (
                'USER_KB_REFERENCE',
                'ORG_LEARNED',
                'PLATFORM_DEFAULT',
                'USER_OVERRIDE',
                'FALLBACK'
              ));
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_risk_analyses_impact_source') THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT ck_risk_analyses_impact_source
              CHECK (impact_source IN (
                'USER_KB_REFERENCE',
                'ORG_LEARNED',
                'PLATFORM_DEFAULT',
                'USER_OVERRIDE',
                'FALLBACK'
              ));
        END IF;
      END$$;
    `);

    // ── 3. FK on last_overridden_by (users table exists from day 1) ──────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_risk_analyses_last_overridden_by') THEN
          ALTER TABLE risk_analyses
            ADD CONSTRAINT fk_risk_analyses_last_overridden_by
              FOREIGN KEY (last_overridden_by)
              REFERENCES users (id)
              ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // NOTE: FK on platform_default_ref_id is added in S.2 (1748000000006)
    // once the target table risk_category_platform_defaults exists.

    // ── 4. Index on risk_score for portfolio severity sorting ────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_risk_analyses_score
        ON risk_analyses (risk_score DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_risk_analyses_score;`);
    await queryRunner.query(`
      ALTER TABLE risk_analyses
        DROP CONSTRAINT IF EXISTS fk_risk_analyses_last_overridden_by,
        DROP CONSTRAINT IF EXISTS ck_risk_analyses_impact_source,
        DROP CONSTRAINT IF EXISTS ck_risk_analyses_likelihood_source,
        DROP CONSTRAINT IF EXISTS ck_risk_analyses_impact_range,
        DROP CONSTRAINT IF EXISTS ck_risk_analyses_likelihood_range,
        DROP COLUMN IF EXISTS platform_default_ref_id,
        DROP COLUMN IF EXISTS last_overridden_at,
        DROP COLUMN IF EXISTS last_overridden_by,
        DROP COLUMN IF EXISTS impact_source,
        DROP COLUMN IF EXISTS likelihood_source,
        DROP COLUMN IF EXISTS risk_score,
        DROP COLUMN IF EXISTS impact,
        DROP COLUMN IF EXISTS likelihood;
    `);
  }
}
