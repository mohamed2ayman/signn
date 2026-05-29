import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, B.6.
 *
 * One-time deterministic backfill of PMBOK Likelihood / Impact / score /
 * source for legacy `risk_analyses` rows still sitting on the S.1 FALLBACK
 * defaults (likelihood=3, impact=3, risk_score=9, *_source=FALLBACK).
 *
 * Legacy rows carry no L/I — only the 3-level `risk_level` enum. We derive
 * L/I/score from it using the SAME conservative mapping the AI writer uses
 * (`severity-mapping.ts`): HIGH→3/5/15, MEDIUM→3/3/9, LOW→2/2/4. These are
 * round-trip stable — `mapScoreToRiskLevel(score)` returns the original
 * level — so `risk_level` is deliberately NOT recomputed (Decision 2).
 *
 * Idempotency + skip-overridden in ONE guard: `WHERE likelihood_source =
 * 'FALLBACK'`. A MEDIUM backfill lands on (3,3,9) — identical to the S.1
 * default — so a value-based filter could not tell a backfilled row from an
 * untouched one. The source column is the only reliable "untouched" marker:
 * after this runs, a touched row's source flips FALLBACK→PLATFORM_DEFAULT,
 * so a re-run matches nothing. The same guard skips USER_OVERRIDE and every
 * already-resolved source (ORG_LEARNED / PLATFORM_DEFAULT / USER_KB_REFERENCE).
 *
 * No override-log rows are written (Decision 3) — this is a system action,
 * not a user override, and would otherwise poison B.4's learned-baseline
 * median (it reads the last 50 override-log rows per org+category).
 *
 * `risk_score` is set explicitly in SQL because the @BeforeUpdate hook does
 * NOT fire on a raw UPDATE (see the entity TSDoc on `risk_score`).
 */
export class BackfillRiskAnalysisLikelihoodImpact1748000000012
  implements MigrationInterface
{
  name = 'BackfillRiskAnalysisLikelihoodImpact1748000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE risk_analyses
      SET
        likelihood = CASE risk_level
          WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 END,
        impact = CASE risk_level
          WHEN 'HIGH' THEN 5 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 END,
        risk_score = CASE risk_level
          WHEN 'HIGH' THEN 15 WHEN 'MEDIUM' THEN 9 WHEN 'LOW' THEN 4 END,
        likelihood_source = 'PLATFORM_DEFAULT',
        impact_source = 'PLATFORM_DEFAULT'
      WHERE likelihood_source = 'FALLBACK'
        -- AND risk_level IN (...) — REQUIRED, not defensive. risk_level is
        -- nullable; without this guard a NULL risk_level row would yield
        -- NULL from the CASE expression and fail the NOT NULL constraint on
        -- likelihood/impact, aborting the entire migration.
        AND risk_level IN ('HIGH', 'MEDIUM', 'LOW');
    `);
    // platform_default_ref_id intentionally left NULL — no platform-default
    // seed exists for legacy categories (e.g. 'liability', 'termination').
    // The NULL ref is also a load-bearing signal: B.5's drift-report uses
    // "PLATFORM_DEFAULT + NULL ref" to distinguish backfilled rows from
    // genuine platform-seeded findings. Do not populate it here.
  }

  public async down(): Promise<void> {
    // No-op intentional. B.6 is a one-time data backfill; reverting it is
    // not a meaningful operation and risks clobbering rows that have since
    // been legitimately re-sourced. Same no-op-down precedent as the
    // corrective migrations 1748000000004 / 1748000000011.
  }
}
