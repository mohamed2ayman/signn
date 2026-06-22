import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest Portal comments-list (feature #1) — per-comment visibility boundary.
 *
 * Adds `is_internal_note` to `contract_comments` so an external guest can be
 * shown the CONVERSATION on their bound contract (their comments + SIGN-team
 * replies meant for them) WITHOUT leaking internal SIGN-team notes.
 *
 * FAIL-CLOSED: the column defaults to TRUE (internal/hidden-from-guest). The
 * `NOT NULL DEFAULT true` backfills EVERY existing comment to hidden — existing
 * comments predate this feature and were never meant for an external guest, so
 * none of them leak. From here on, visibility is OPT-IN at write time: a guest's
 * own comments are written `false` (a guest sees what they wrote), and a managing
 * user must explicitly mark a comment guest-visible (`is_internal_note = false`)
 * for it to reach a guest. The guest GET is a WHITELIST: it returns ONLY
 * `is_internal_note = false` rows. (Mirrors the proven
 * `support_ticket_replies.is_internal_note` non-staff-filter pattern.)
 */
export class AddIsInternalNoteToContractComments1760000000001
  implements MigrationInterface
{
  name = 'AddIsInternalNoteToContractComments1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `NOT NULL DEFAULT true` sets EVERY existing row to hidden-from-guest in
    // one shot — the fail-closed backfill. No per-author exception: even a
    // guest's PRE-EXISTING comments start hidden (v1 had no guest GET, so no
    // guest ever relied on them); visibility for guest comments is established
    // going forward at write time, not retroactively. (Postgres 11+ applies a
    // constant default as metadata only — no table rewrite.)
    await queryRunner.query(`
      ALTER TABLE "contract_comments"
      ADD COLUMN IF NOT EXISTS "is_internal_note" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contract_comments" DROP COLUMN IF EXISTS "is_internal_note"
    `);
  }
}
