import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, B.5 (Migration 1 of 2).
 *
 * Adds the missing index on `risk_analysis_override_log.risk_analysis_id`.
 *
 * The B.5 explanation endpoint (`GET /risk-analysis/:id/explanation`)
 * filters the override log by `risk_analysis_id` and orders by
 * `created_at DESC`. Postgres does NOT auto-index FK columns, and the
 * existing composite index `(organization_id, risk_category, created_at)`
 * from S.4 does NOT cover a `risk_analysis_id` filter (it's not a prefix
 * of that index). Without this index the explanation query seq-scans —
 * harmless today (0-3 rows per finding) but degrades as the log grows
 * linearly with platform usage.
 *
 * Composite `(risk_analysis_id, created_at DESC)` so the query's
 * `WHERE risk_analysis_id = :id ORDER BY created_at DESC` resolves as a
 * single index scan with no separate sort step.
 *
 * Idempotent + reversible.
 */
export class AddOverrideLogRiskAnalysisIdIndex1748000000010
  implements MigrationInterface
{
  name = 'AddOverrideLogRiskAnalysisIdIndex1748000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_risk_analysis_override_log_risk_analysis_id
        ON risk_analysis_override_log (risk_analysis_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_risk_analysis_override_log_risk_analysis_id;
    `);
  }
}
