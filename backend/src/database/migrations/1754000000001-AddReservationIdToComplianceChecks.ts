import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — Metering Part 2: link compliance_checks to metering_ledger.
 *
 * Adds ONE nullable column `reservation_id` (UUID) to compliance_checks. This
 * is the linkage between a compliance run and its metering reservation, so
 * the lazy poll-driven reconcile in refreshFromAi can call
 * `MeteringService.commit(reservation_id)` or `release(reservation_id)` when
 * the terminal state lands.
 *
 * NULLABLE because:
 *   - Pre-existing rows pre-date metering and have no reservation.
 *   - Runs that fail SYNCHRONOUSLY before any check row is persisted
 *     never get one either (release fires in-request via the controller's
 *     consumer wiring; no row to carry).
 *
 * NO foreign key to metering_ledger.reservation_id because:
 *   - reservation_id is an opaque UUID minted by the engine. The link is
 *     attribution, not ownership — a deleted ledger row (e.g. retention
 *     pruning at some future date) MUST NOT cascade into compliance.
 *   - Mirrors the engine's own choice to NOT FK ledger.actor_ref /
 *     contract_ref (engine entity comment: "attribution, NOT subject").
 *
 * Indexed because the future operator query "show me the reservation
 * behind this check" is admin-cheap with the index and slow without it.
 *
 * Idempotent — matches the existing migration idiom (no EXCEPTION WHEN;
 * IF NOT EXISTS for both ADD COLUMN and CREATE INDEX). Lessons #31/#103/#111.
 */
export class AddReservationIdToComplianceChecks1754000000001
  implements MigrationInterface
{
  name = 'AddReservationIdToComplianceChecks1754000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE compliance_checks
        ADD COLUMN IF NOT EXISTS reservation_id UUID NULL
    `);

    // Partial-ish: every column-present row will have either NULL (pre-
    // existing or sync-failed) or a real UUID. The index covers
    // non-NULL rows only — cheap because the typical row IS non-NULL
    // post-wiring.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_compliance_checks_reservation_id
        ON compliance_checks (reservation_id)
        WHERE reservation_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_compliance_checks_reservation_id`,
    );
    await queryRunner.query(
      `ALTER TABLE compliance_checks DROP COLUMN IF EXISTS reservation_id`,
    );
  }
}
