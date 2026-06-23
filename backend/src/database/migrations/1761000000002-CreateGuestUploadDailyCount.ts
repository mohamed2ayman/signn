import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feature #4 — race-safe daily cap for guest uploads.
 *
 * A per-(contract, UTC-day) counter row. The cap (5 guest uploads/day per
 * contract) is enforced by a SINGLE atomic conditional UPSERT against this
 * table — the same shape as the metering engine's reserve gate (Rule 9
 * Invariant 2: a hot single-row counter uses an atomic conditional UPDATE,
 * NOT a held lock). The row lock is held only for that statement's duration,
 * so NOTHING is locked across the heavy upload work (storage + metering
 * sub-transaction + AI dispatch) — avoiding the pool-starvation deadlock an
 * advisory lock held across those operations would risk.
 */
export class CreateGuestUploadDailyCount1761000000002
  implements MigrationInterface
{
  name = 'CreateGuestUploadDailyCount1761000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guest_upload_daily_counts (
        contract_id uuid        NOT NULL,
        day         date        NOT NULL,
        count       integer     NOT NULL DEFAULT 0,
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_guest_upload_daily_counts PRIMARY KEY (contract_id, day),
        CONSTRAINT guest_upload_daily_counts_count_check CHECK (count >= 0),
        CONSTRAINT fk_guest_upload_daily_counts_contract
          FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS guest_upload_daily_counts`);
  }
}
