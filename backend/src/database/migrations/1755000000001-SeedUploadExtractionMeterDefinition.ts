import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — second metered consumer wiring (managing-user upload path).
 *
 * Seeds the `upload_extraction` row in `meter_definitions`. The meter_key
 * already exists in the `meter_key_enum` PG enum (created by migration
 * 1753000000001 — closed set: compliance, risk, ai_assistant_message,
 * upload_extraction). The engine itself is untouched by this migration —
 * we ONLY add a definition row.
 *
 *   unit          = 'extraction'   — one charge per upload-and-dispatch.
 *   window_type   = 'per_contract' — uniform with compliance. The resolver
 *                   already supports this; no engine change.
 *   fail_mode     = 'closed'       — Anthropic token + Celery worker cost
 *                   is real money; closed-fail on resolver / store error
 *                   is the safe default (Rule 9 invariant 7).
 *   default_limit = 5000           — Placeholder. Ops will set real
 *                   per-plan caps via plan_allowances + per-org overrides
 *                   via subject_allowances. NEVER treat this number as
 *                   authoritative (CLAUDE.md Rule 9 invariant 7). 5000
 *                   chosen generous on purpose so dev / staging don't hit
 *                   it accidentally before real numbers land.
 *
 * Idempotent — ON CONFLICT DO NOTHING. Safe to run on a DB that already
 * has the compliance row, AND safe to re-run on a DB that already has
 * this row (idempotent, no UPDATE — Ops-set caps are owned downstream
 * of this migration).
 *
 * NO touch to the compliance row. NO ALTER TYPE — the enum value is
 * already in place. NO touch to plan_allowances / subject_allowances —
 * Ops territory.
 *
 * Lessons #31 / #103 / #111 / #143: no EXCEPTION WHEN blocks; no
 * silent-failure idiom. ON CONFLICT DO NOTHING is the canonical
 * idempotency shape here.
 */
export class SeedUploadExtractionMeterDefinition1755000000001
  implements MigrationInterface
{
  name = 'SeedUploadExtractionMeterDefinition1755000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO meter_definitions
        (meter_key, unit, window_type, fail_mode, default_limit)
      VALUES
        ('upload_extraction', 'extraction', 'per_contract', 'closed', 5000)
      ON CONFLICT (meter_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Targeted delete. plan_allowances / subject_allowances are RESTRICT-FK
    // referenced — this DELETE will fail if Ops has already wired plan
    // caps. That's the correct safety net: rolling back the seed must be
    // a deliberate Ops action, not silent FK damage.
    await queryRunner.query(`
      DELETE FROM meter_definitions WHERE meter_key = 'upload_extraction'
    `);
  }
}
