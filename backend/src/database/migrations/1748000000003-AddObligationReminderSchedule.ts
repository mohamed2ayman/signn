import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.1 — Obligation Tracking & Deadline Alerts
 *
 * Adds `reminder_schedule` to the `obligations` table — an array of integers
 * representing the days-before-due-date at which reminders are sent.
 *
 * Default: ARRAY[30, 14, 7, 1] — reminders at 30, 14, 7, and 1 day(s) before
 * the due date. Per-obligation overrides allow more or fewer reminder tiers.
 *
 * The existing `reminder_days_before` column (added in Phase 3.4) served as a
 * single integer. This new column replaces its role functionally while
 * `reminder_days_before` is left unchanged for backward-compat with legacy
 * reminder log rows.
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 */
export class AddObligationReminderSchedule1748000000003 implements MigrationInterface {
  name = 'AddObligationReminderSchedule1748000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE obligations
        ADD COLUMN IF NOT EXISTS reminder_schedule INTEGER[] NOT NULL DEFAULT ARRAY[30, 14, 7, 1];
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE obligations
        DROP COLUMN IF EXISTS reminder_schedule;
    `);
  }
}
