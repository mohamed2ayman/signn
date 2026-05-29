import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, S.3
 *
 * Creates `risk_category_org_learned_baselines` — once an org accumulates
 * ≥10 user overrides for a given (org, risk_category) pair, the B.4
 * learned-baseline job computes the median L,I from the last 50 overrides
 * and upserts a row here. The B.1 resolver's step 2 (ORG_LEARNED) reads
 * this table and only returns a result when `override_count >= 10`.
 *
 * UNIQUE (organization_id, risk_category) — one baseline per (org, cat).
 * The unique index doubles as the lookup index for the resolver query —
 * no separate index needed.
 *
 * Idempotent + reversible.
 */
export class CreateRiskCategoryOrgLearnedBaselines1748000000007
  implements MigrationInterface
{
  name = 'CreateRiskCategoryOrgLearnedBaselines1748000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_category_org_learned_baselines (
        id                   UUID         NOT NULL DEFAULT uuid_generate_v4(),
        organization_id      UUID         NOT NULL,
        risk_category        VARCHAR(100) NOT NULL,
        learned_likelihood   SMALLINT     NOT NULL,
        learned_impact       SMALLINT     NOT NULL,
        override_count       INT          NOT NULL DEFAULT 0,
        last_recomputed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        CONSTRAINT pk_risk_category_org_learned_baselines
          PRIMARY KEY (id),

        CONSTRAINT ck_risk_category_org_learned_baselines_likelihood
          CHECK (learned_likelihood BETWEEN 1 AND 5),

        CONSTRAINT ck_risk_category_org_learned_baselines_impact
          CHECK (learned_impact BETWEEN 1 AND 5),

        CONSTRAINT fk_risk_category_org_learned_baselines_organization
          FOREIGN KEY (organization_id)
          REFERENCES organizations (id)
          ON DELETE CASCADE
      );
    `);

    // UNIQUE on (organization_id, risk_category) — one baseline per pair.
    // Doubles as the lookup index for the resolver's step-2 query, so no
    // separate idx_ index is needed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_category_org_learned_baselines_org_cat
        ON risk_category_org_learned_baselines (organization_id, risk_category);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_risk_category_org_learned_baselines_org_cat;
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS risk_category_org_learned_baselines;`,
    );
  }
}
