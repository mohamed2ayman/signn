import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.19 Slice 4 — redline notification debounce window (Phase 1B).
 *
 * ONE row per OPEN debounce window, keyed (contract_id, event_class,
 * recipient_key). The row IS the window:
 *
 *   - INSERT (no window open)  → pending_count stays 0 → the caller sends the
 *     notification IMMEDIATELY (leading edge) and this row arms the window.
 *   - ON CONFLICT (window open) → pending_count += 1 → the caller sends
 *     NOTHING; the sweeper flushes one digest covering the suppressed events.
 *
 * The whole claim is a SINGLE atomic conditional UPSERT (the
 * guest_upload_daily_counts / metering-reserve idiom — ARCHITECTURE RULE 9
 * Invariant 2, lesson #177): the row lock lives only for that statement, so
 * nothing is held across the email/dispatch work.
 *
 * `recipient_key` is a synthetic discriminator (`u:<uuid>` for a real user row,
 * `e:<lower(email)>` for an email-only recipient) so the unique index never has
 * to reason about NULL semantics — a nullable column in a UNIQUE index treats
 * NULLs as distinct on PG < 15 and would silently open a second window per
 * recipient. The real send targets stay in recipient_user_id / recipient_email.
 *
 * The sweeper DELETEs rows to claim them, so this table only ever holds OPEN
 * windows (small, bounded by concurrent negotiations). `idx_..._window_ends_at`
 * therefore matches the drain predicate `WHERE window_ends_at < NOW()` exactly
 * — no partial-index/predicate mismatch (the MeteringCleanupProcessor rule).
 */
export class CreateRedlineNotificationBatches1773000000001
  implements MigrationInterface
{
  name = 'CreateRedlineNotificationBatches1773000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS redline_notification_batches (
        id                uuid         NOT NULL DEFAULT gen_random_uuid(),
        contract_id       uuid         NOT NULL,
        event_class       varchar(16)  NOT NULL,
        recipient_key     varchar(340) NOT NULL,
        recipient_user_id uuid         NULL,
        recipient_email   varchar(320) NULL,
        recipient_lang    varchar(10)  NOT NULL DEFAULT 'en',
        pending_count     integer      NOT NULL DEFAULT 0,
        window_ends_at    timestamptz  NOT NULL,
        created_at        timestamptz  NOT NULL DEFAULT now(),
        updated_at        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT pk_redline_notification_batches PRIMARY KEY (id),
        CONSTRAINT uq_redline_notification_batches_window
          UNIQUE (contract_id, event_class, recipient_key),
        CONSTRAINT redline_notification_batches_pending_count_check
          CHECK (pending_count >= 0),
        CONSTRAINT redline_notification_batches_event_class_check
          CHECK (event_class IN ('PROPOSED', 'DECIDED')),
        CONSTRAINT redline_notification_batches_recipient_target_check
          CHECK (recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL),
        CONSTRAINT fk_redline_notification_batches_contract
          FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        CONSTRAINT fk_redline_notification_batches_recipient
          FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Drain index — the predicate is literally `window_ends_at < NOW()`.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_redline_notification_batches_window_ends_at
        ON redline_notification_batches (window_ends_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_redline_notification_batches_window_ends_at`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS redline_notification_batches`,
    );
  }
}
