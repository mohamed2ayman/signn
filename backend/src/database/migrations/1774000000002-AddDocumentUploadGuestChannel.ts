import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest Portal #8c Part 4a (Checkpoint B) — persist the upload CHANNEL.
 *
 * WHY THIS EXISTS
 * `DocumentProcessingService.isGuestUploadedDoc` decides whether an
 * extraction writes Option-C PROPOSED clauses (guest channel) or LIVE clauses
 * + party backfill (managing channel). Until now it answered that by asking a
 * LIVE question — "does this uploader hold a guest binding right now?" — which
 * made an immutable historical property of the document depend on mutable
 * authorization state. Once binding revocation exists (migration
 * 1774000000001) that coupling becomes a real defect: revoking a counterparty
 * mid-extraction would RETROACTIVELY reclassify their in-flight proposed
 * document as a LIVE one, promoting their clauses into the host's canonical
 * set and enabling party backfill from a document the host never accepted.
 *
 * "Was this uploaded through the guest channel?" is a fact fixed at upload
 * time. So we store it, and classification stops reading the binding table
 * altogether — it can no longer be perturbed by ANY future binding change
 * (revocation, re-grant, cascade delete).
 *
 * THE BACKFILL IS EXACT, NOT A GUESS
 * It reproduces the OLD predicate verbatim for every existing row:
 *   uploader.account_type = 'GUEST'  OR  a guest_contract_access row exists
 *                                        for (uploaded_by, contract_id)
 * The EXISTS clause is deliberately revocation-BLIND (no `revoked_at IS NULL`),
 * which is what makes it faithful: it is the historical
 * "did this user ever hold a binding here", exactly what the old live read
 * returned at a time when no row could yet be revoked. Every pre-existing
 * document therefore keeps the classification it already had — this migration
 * changes no document's behaviour, it only freezes it.
 *
 * NOT NULL DEFAULT false is safe because the backfill runs in the same
 * migration, before anything can observe the column.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS; the backfill is naturally re-runnable
 * (it only ever sets TRUE on rows matching the predicate). No ALTER TYPE, so
 * no `transaction = false`. down↔up verified.
 */
export class AddDocumentUploadGuestChannel1774000000002
  implements MigrationInterface
{
  name = 'AddDocumentUploadGuestChannel1774000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE document_uploads
      ADD COLUMN IF NOT EXISTS "is_guest_upload" BOOLEAN NOT NULL DEFAULT false
    `);

    // Faithful backfill — the OLD isGuestUploadedDoc predicate, verbatim.
    await queryRunner.query(`
      UPDATE document_uploads d
         SET is_guest_upload = TRUE
       WHERE d.is_guest_upload = FALSE
         AND (
           EXISTS (
             SELECT 1 FROM users u
              WHERE u.id = d.uploaded_by
                AND u.account_type = 'GUEST'
           )
           OR EXISTS (
             SELECT 1 FROM guest_contract_access g
              WHERE g.user_id = d.uploaded_by
                AND g.contract_id = d.contract_id
           )
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE document_uploads DROP COLUMN IF EXISTS "is_guest_upload"
    `);
  }
}
