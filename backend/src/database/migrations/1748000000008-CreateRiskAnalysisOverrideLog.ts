import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, S.4
 *
 * Creates `risk_analysis_override_log` — append-only audit table for
 * user overrides of risk-finding L,I values. The B.3 override service
 * inserts one row per override; the B.4 learned-baseline job reads the
 * last 50 rows per (org, risk_category) to compute the median.
 *
 * Columns mirror the override event:
 *   - previous_*  : L, I, and source BEFORE the override
 *   - new_*       : L, I that the user set
 *   - user_id     : who made the override (nullable — see note below)
 *   - note        : optional user-provided rationale
 *
 * `user_id` is NULLable with FK ON DELETE SET NULL — matches the
 * existing audit-log convention and avoids blocking the SOC 2 / GDPR
 * right-to-erasure work scheduled for Phase 10. Attribution loss on
 * user-deletion is the correct trade-off: the event, timestamp, deltas,
 * and note are all preserved even when the user is gone.
 *
 * The org-scoped + category-scoped composite index supports B.4's
 * "SELECT ... WHERE org_id = ? AND risk_category = ? ORDER BY created_at
 * DESC LIMIT 50" query path.
 *
 * Idempotent + reversible.
 */
export class CreateRiskAnalysisOverrideLog1748000000008
  implements MigrationInterface
{
  name = 'CreateRiskAnalysisOverrideLog1748000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_analysis_override_log (
        id                   UUID         NOT NULL DEFAULT uuid_generate_v4(),
        risk_analysis_id     UUID         NOT NULL,
        organization_id      UUID         NOT NULL,
        risk_category        VARCHAR(100) NOT NULL,
        previous_likelihood  SMALLINT     NOT NULL,
        previous_impact      SMALLINT     NOT NULL,
        new_likelihood       SMALLINT     NOT NULL,
        new_impact           SMALLINT     NOT NULL,
        previous_source      VARCHAR(20)  NOT NULL,
        user_id              UUID         NULL,
        note                 TEXT         NULL,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        CONSTRAINT pk_risk_analysis_override_log
          PRIMARY KEY (id),

        CONSTRAINT ck_risk_analysis_override_log_previous_likelihood
          CHECK (previous_likelihood BETWEEN 1 AND 5),
        CONSTRAINT ck_risk_analysis_override_log_previous_impact
          CHECK (previous_impact BETWEEN 1 AND 5),
        CONSTRAINT ck_risk_analysis_override_log_new_likelihood
          CHECK (new_likelihood BETWEEN 1 AND 5),
        CONSTRAINT ck_risk_analysis_override_log_new_impact
          CHECK (new_impact BETWEEN 1 AND 5),
        CONSTRAINT ck_risk_analysis_override_log_previous_source
          CHECK (previous_source IN (
            'USER_KB_REFERENCE',
            'ORG_LEARNED',
            'PLATFORM_DEFAULT',
            'USER_OVERRIDE',
            'FALLBACK'
          )),

        CONSTRAINT fk_risk_analysis_override_log_risk_analysis
          FOREIGN KEY (risk_analysis_id)
          REFERENCES risk_analyses (id)
          ON DELETE CASCADE,
        CONSTRAINT fk_risk_analysis_override_log_organization
          FOREIGN KEY (organization_id)
          REFERENCES organizations (id)
          ON DELETE CASCADE,
        CONSTRAINT fk_risk_analysis_override_log_user
          FOREIGN KEY (user_id)
          REFERENCES users (id)
          ON DELETE SET NULL
      );
    `);

    // Composite index for B.4's median computation query:
    // SELECT ... WHERE organization_id = ? AND risk_category = ?
    //          ORDER BY created_at DESC LIMIT 50
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_risk_analysis_override_log_org_cat_created
        ON risk_analysis_override_log (organization_id, risk_category, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_risk_analysis_override_log_org_cat_created;
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS risk_analysis_override_log;`,
    );
  }
}
