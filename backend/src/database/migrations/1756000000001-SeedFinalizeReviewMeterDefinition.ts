import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — third metered consumer wiring (managing-user finalize-review).
 *
 * Two ADDITIVE steps:
 *
 *   1. ALTER TYPE meter_key_enum ADD VALUE IF NOT EXISTS 'finalize_review'.
 *      Unlike `upload_extraction` (which was already in the original closed
 *      set created by 1753000000001), `finalize_review` is a NEW meter_key —
 *      so it needs the enum value added. This is the SINGLE PG-schema touch
 *      the new consumer requires beyond the definition row.
 *
 *   2. Seed the `finalize_review` row in `meter_definitions`.
 *
 *        unit          = 'finalize'     — one charge per finalize-review action.
 *        window_type   = 'per_contract' — uniform with compliance +
 *                        upload_extraction. The resolver already supports
 *                        this; NO engine change.
 *        fail_mode     = 'closed'       — the finalize burst dispatches three
 *                        Anthropic agents (risk + obligations + conflict);
 *                        real token cost → fail-closed is the safe default
 *                        (Rule 9 invariant 7).
 *        default_limit = 5000           — PLACEHOLDER. Ops sets real per-plan
 *                        caps via plan_allowances + per-org overrides via
 *                        subject_allowances. NEVER treat this number as
 *                        authoritative (CLAUDE.md Rule 9 invariant 7). 5000
 *                        chosen generous on purpose so dev / staging don't
 *                        hit it accidentally before real numbers land.
 *
 * ONE finalize action = ONE reserve = ONE charge covering the whole 3-agent
 * burst (Ayman's decision — NOT per-agent). The risk / obligations /
 * conflict agents are NOT metered separately.
 *
 * `transaction = false` is REQUIRED — `ALTER TYPE ... ADD VALUE` cannot run
 * inside a transaction block, and the seed INSERT (which uses the new value
 * as PK) must see it COMMITTED. With transaction=false each statement
 * auto-commits, so the ADD VALUE commits before the INSERT references it.
 * Same pattern as Phase 7.25 (1751000000005) + Phase 7.3.
 *
 * Idempotent — ALTER TYPE uses IF NOT EXISTS; INSERT uses ON CONFLICT DO
 * NOTHING. Safe to re-run. NO touch to compliance / upload_extraction
 * definitions. NO touch to plan_allowances / subject_allowances (Ops
 * territory). NO `EXCEPTION WHEN` blocks (lessons #31 / #103 / #111 / #143).
 *
 * NO engine code changes accompany this migration — the metering
 * resolver / reserve / commit / release / sweeper treat finalize_review
 * (per_contract / closed) exactly like the two existing per_contract / closed
 * meters. The ONLY TypeScript change is the additive MeterKey enum value.
 */
export class SeedFinalizeReviewMeterDefinition1756000000001
  implements MigrationInterface
{
  name = 'SeedFinalizeReviewMeterDefinition1756000000001';

  // ALTER TYPE ... ADD VALUE forbids running inside a transaction block.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1 — additive enum value. IF NOT EXISTS makes it idempotent.
    await queryRunner.query(`
      ALTER TYPE meter_key_enum ADD VALUE IF NOT EXISTS 'finalize_review'
    `);

    // Step 2 — seed the definition row. Runs as a separate auto-committed
    // statement (transaction=false), so the enum value added in step 1 is
    // already committed and usable here.
    await queryRunner.query(`
      INSERT INTO meter_definitions
        (meter_key, unit, window_type, fail_mode, default_limit)
      VALUES
        ('finalize_review', 'finalize', 'per_contract', 'closed', 5000)
      ON CONFLICT (meter_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Targeted delete of the seed row only. plan_allowances /
    // subject_allowances are RESTRICT-FK referenced — this DELETE will fail
    // if Ops has already wired plan caps on finalize_review. That's the
    // correct safety net: rolling back the seed must be a deliberate Ops
    // action, not silent FK damage.
    //
    // The enum value itself is NOT removed — PostgreSQL has no
    // `ALTER TYPE ... DROP VALUE`. Leaving 'finalize_review' in the enum on
    // a down-migration is harmless (an unused enum value), and re-running
    // up() is idempotent (IF NOT EXISTS).
    await queryRunner.query(`
      DELETE FROM meter_definitions WHERE meter_key = 'finalize_review'
    `);
  }
}
