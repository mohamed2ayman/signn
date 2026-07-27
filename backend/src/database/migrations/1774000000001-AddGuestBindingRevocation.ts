import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest Portal #8c Part 4a — binding revocation (schema).
 *
 * A host must be able to withdraw a counterparty's access to a shared
 * contract. Today the ONLY way to do that is a hard DELETE of the
 * `guest_contract_access` row, which destroys the historical fact that the
 * share ever existed — and with it the provenance the proposed-vs-live
 * document classification depends on (DocumentProcessingService.
 * isGuestUploadedDoc). So revocation is a SOFT stamp, never a delete.
 *
 * Design (locked at Part 4a recon):
 *  - revoked_at  — timestamptz NULL. NULL = LIVE binding. This column is the
 *    authorization discriminator: every binding READ in
 *    ContractAccessService filters `revoked_at IS NULL`, so a revoked row
 *    grants nothing while remaining on disk as history.
 *  - revoked_by  — uuid NULL, FK → users(id) ON DELETE **SET NULL**. Mirrors
 *    the sibling `granted_by` column on this very table (line 58-63 of
 *    guest-contract-access.entity.ts) and its stated rationale: deleting the
 *    admin who performed the action must NOT break the audit-trail row that
 *    points at the historical grant/revocation. DELIBERATELY NOT the RESTRICT
 *    used for contracts.parent_contract_id (1769000000001) — that column
 *    carries structural hierarchy, this one carries an actor reference.
 *    NULL also legitimately means "revoked by a since-deleted user".
 *  - Existing rows are never backfilled: `revoked_at` defaults to NULL, i.e.
 *    every binding that exists today stays LIVE. Additive, zero behaviour
 *    change until the read filter (Piece 2) ships alongside it.
 *
 * Index rationale — HONEST accounting, because a redundant index is a real
 * write cost on a table three hot authorization paths read:
 *  - hasGuestBinding / findForGuest are POINT lookups on (user_id,
 *    contract_id). Those are already optimally served by the EXISTING unique
 *    constraint `uq_guest_contract_access_user_contract`, which returns AT
 *    MOST ONE row; the added `revoked_at IS NULL` predicate is then a free
 *    recheck on that single tuple. A new index would buy them NOTHING.
 *  - listGuestBindings (#8a, GET /guest/my-contracts) is the one query that
 *    genuinely benefits: it filters `user_id = ? AND revoked_at IS NULL` and
 *    then ORDERs BY granted_at DESC. The existing
 *    `idx_guest_contract_access_user_id` covers only user_id, so it must sort
 *    afterwards and must visit revoked rows it will then discard.
 *    `(user_id, granted_at DESC) WHERE revoked_at IS NULL` serves the filter
 *    AND the sort in one index-ordered scan over live rows only.
 *  So exactly ONE partial index is added, shaped for the ONE query that can
 *  use it. It is partial (live rows only) so it stays small even as revoked
 *  history accumulates.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS + DO $$ IF NOT EXISTS pg_constraint $$
 * for the FK (Postgres has no ADD CONSTRAINT IF NOT EXISTS) + CREATE INDEX IF
 * NOT EXISTS — never EXCEPTION WHEN (lessons #31/#103/#111). No ALTER TYPE, so
 * no `transaction = false` needed. down↔up round-trip verified.
 */
export class AddGuestBindingRevocation1774000000001
  implements MigrationInterface
{
  name = 'AddGuestBindingRevocation1774000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NULL = live. Never backfilled — every existing binding stays live.
    await queryRunner.query(`
      ALTER TABLE guest_contract_access
      ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE guest_contract_access
      ADD COLUMN IF NOT EXISTS "revoked_by" uuid NULL
    `);

    // SET NULL — same contract as the sibling granted_by column: removing the
    // actor must not break the historical revocation row.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_guest_contract_access_revoked_by'
        ) THEN
          ALTER TABLE guest_contract_access
          ADD CONSTRAINT "FK_guest_contract_access_revoked_by"
          FOREIGN KEY ("revoked_by")
          REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // Serves listGuestBindings' filter + ORDER BY in one live-rows-only scan.
    // The point lookups gain nothing here — see the index rationale above.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guest_contract_access_live_user"
      ON "guest_contract_access" ("user_id", "granted_at" DESC)
      WHERE "revoked_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_guest_contract_access_live_user"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_guest_contract_access_revoked_by'
        ) THEN
          ALTER TABLE guest_contract_access
          DROP CONSTRAINT "FK_guest_contract_access_revoked_by";
        END IF;
      END$$;
    `);
    await queryRunner.query(`
      ALTER TABLE guest_contract_access DROP COLUMN IF EXISTS "revoked_by"
    `);
    await queryRunner.query(`
      ALTER TABLE guest_contract_access DROP COLUMN IF EXISTS "revoked_at"
    `);
  }
}
