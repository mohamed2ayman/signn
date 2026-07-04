import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest chat Slice 1 — reservation linkage for the guest_ai_query meter.
 *
 * Mirrors 1754000000001 (compliance_checks.reservation_id): the consumer's
 * domain row carries the metering reservation id so the lazy reconcile path
 * (the guest status poll) can commit/release across the async boundary.
 *
 * - NULLABLE: pre-existing rows and un-metered (managing-user) chat messages
 *   never carry a reservation.
 * - NO foreign key to metering_ledger.reservation_id — attribution, not
 *   ownership (a future ledger-retention prune must NOT cascade into chat).
 * - Partial index for ops "show me the reservation behind this message".
 */
export class AddReservationIdToChatMessages1763000000003
  implements MigrationInterface
{
  name = 'AddReservationIdToChatMessages1763000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_messages
        ADD COLUMN IF NOT EXISTS reservation_id uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_reservation_id
        ON chat_messages (reservation_id)
        WHERE reservation_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_chat_messages_reservation_id`,
    );
    await queryRunner.query(
      `ALTER TABLE chat_messages DROP COLUMN IF EXISTS reservation_id`,
    );
  }
}
