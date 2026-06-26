import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest extraction completion (Slice 1) — one-shot cleanup of permanently
 * stuck guest uploads.
 *
 * Before this slice, NOTHING drove the extraction pipeline forward for a guest
 * upload (the managing status route is walled by `findInOrg`, which a guest's
 * null org can never pass). Every guest upload created before this fix is
 * therefore stranded at `EXTRACTING_TEXT` with an AI job result that has since
 * EXPIRED (Celery results are not retained) — they can NEVER advance, even with
 * the new guest driver, because there is no live job to poll.
 *
 * Mark exactly those rows FAILED with an explanatory message and clear the dead
 * `processing_job_id`. Their GUEST_UPLOAD reservations were already released by
 * the engine sweeper (the reserve was never committed because the pipeline
 * never completed), so NO metering action is needed here.
 *
 * SCOPED precisely — only rows that are:
 *   - `processing_status = 'EXTRACTING_TEXT'` (the stuck state), AND
 *   - uploaded by a `GUEST` account (`users.account_type`), AND
 *   - created BEFORE this migration's authoring instant (2026-06-26 UTC) — so a
 *     guest upload that is genuinely mid-extraction AT or AFTER deploy (now
 *     drivable via the new guest status endpoint) is NEVER touched.
 *
 * Idempotent by construction: after it runs those rows are FAILED, so a re-run
 * matches zero rows. No `down()` — a data cleanup of un-advanceable rows is not
 * meaningfully reversible (the original dead job_id is gone); reverting to
 * EXTRACTING_TEXT would only re-strand them.
 */
export class FailStuckGuestExtractions1762000000002
  implements MigrationInterface
{
  name = 'FailStuckGuestExtractions1762000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE document_uploads du
      SET processing_status = 'FAILED',
          processing_job_id = NULL,
          error_message = 'Guest extraction could not complete: this upload predates the guest extraction-completion driver and its AI job result has expired. Please re-upload the new version to retry.',
          updated_at = now()
      FROM users u
      WHERE du.uploaded_by = u.id
        AND u.account_type = 'GUEST'
        AND du.processing_status = 'EXTRACTING_TEXT'
        AND du.created_at < '2026-06-26 00:00:00+00'
    `);
  }

  public async down(): Promise<void> {
    // No-op: a one-shot cleanup of permanently un-advanceable rows is not
    // reversible (the original dead processing_job_id is gone). Reverting to
    // EXTRACTING_TEXT would only re-strand the rows.
  }
}
