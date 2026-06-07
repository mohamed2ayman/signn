import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — Metering second consumer wiring (managing-user upload).
 *
 * Adds ONE nullable column `reservation_id` (UUID) to `document_uploads`.
 * Mirrors the compliance-checks reservation_id column shape from migration
 * 1754000000001 verbatim — same rationale below.
 *
 * NULLABLE because:
 *   - Pre-existing rows pre-date metering and have no reservation.
 *   - Sync failures BEFORE the doc row is persisted (e.g. storage upload
 *     throws) never get one either — release fires in-request via the
 *     consumer's `releaseInFlight` path on a dangling reservation_id
 *     held only in local state, no DB row to carry it.
 *
 * NO foreign key to `metering_ledger.reservation_id` because:
 *   - `reservation_id` is an opaque UUID minted by the engine. The link is
 *     attribution, not ownership — a future ledger-retention prune MUST
 *     NOT cascade into document_uploads.
 *   - Mirrors the engine's own choice to NOT FK ledger.actor_ref /
 *     contract_ref ("attribution, NOT subject").
 *
 * Partial index on non-NULL rows for the operator query "show me the
 * reservation behind this document". Cheap because the typical post-
 * wiring row IS non-NULL.
 *
 * Idempotent — `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`,
 * no `EXCEPTION WHEN` blocks. Lessons #31 / #103 / #111 / #143.
 */
export class AddReservationIdToDocumentUploads1755000000002
  implements MigrationInterface
{
  name = 'AddReservationIdToDocumentUploads1755000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE document_uploads
        ADD COLUMN IF NOT EXISTS reservation_id UUID NULL
    `);

    // Partial index — only covers reserved+persisted rows. Pre-existing
    // and sync-failed-pre-persist rows are NULL and don't bloat the
    // index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_document_uploads_reservation_id
        ON document_uploads (reservation_id)
        WHERE reservation_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_document_uploads_reservation_id`,
    );
    await queryRunner.query(
      `ALTER TABLE document_uploads DROP COLUMN IF EXISTS reservation_id`,
    );
  }
}
