import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest chat Slice 1 — guest AI questions about the bound contract.
 *
 * Seeds a SEPARATE `guest_ai_query` meter, distinct from
 * `ai_assistant_message`, so guest usage is capped/attributed independently
 * and never consumes the host org's managing AI quota. Subject is the HOST
 * org (the resolver derives contract → project → organization_id; a guest's
 * null org is never trusted).
 *
 * This meter is BILLING/ATTRIBUTION only. The product-locked daily cap of
 * 20 guest questions/day PER CONTRACT is enforced at the ROUTE layer
 * (atomic conditional UPSERT in GuestChatService, mirroring guest_upload)
 * because the metering engine has no per-day window (only
 * rolling[throws]/calendar_period[monthly, org-scoped]/per_contract[lifetime]/
 * lifetime — see MeteringResolver computeWindowKey). `default_limit` is a
 * deliberately HIGH placeholder so the billing meter never becomes the
 * binding constraint; real caps are Ops-set via plan_allowances /
 * subject_allowances.
 *
 * Mirrors 1761000000001 (guest_upload): a brand-new enum value, so this is
 * an ALTER TYPE + seed migration that MUST run with transaction = false
 * (lessons #31/#103/#111/#143 — IF NOT EXISTS / ON CONFLICT, never
 * EXCEPTION WHEN).
 */
export class SeedGuestAiQueryMeterDefinition1763000000001
  implements MigrationInterface
{
  name = 'SeedGuestAiQueryMeterDefinition1763000000001';

  // ALTER TYPE ... ADD VALUE forbids running inside a transaction block.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1 — additive enum value. IF NOT EXISTS makes it idempotent.
    await queryRunner.query(`
      ALTER TYPE meter_key_enum ADD VALUE IF NOT EXISTS 'guest_ai_query'
    `);

    // Step 2 — seed the definition row. Runs as a separate auto-committed
    // statement (transaction=false), so the enum value added in step 1 is
    // already committed and usable here.
    await queryRunner.query(`
      INSERT INTO meter_definitions
        (meter_key, unit, window_type, fail_mode, default_limit)
      VALUES
        ('guest_ai_query', 'message', 'per_contract', 'closed', 1000000)
      ON CONFLICT (meter_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The enum value itself is NOT removed — PostgreSQL has no
    // ALTER TYPE ... DROP VALUE. Leaving it is harmless.
    await queryRunner.query(`
      DELETE FROM meter_definitions WHERE meter_key = 'guest_ai_query'
    `);
  }
}
