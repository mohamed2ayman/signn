import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.1 — Obligation Tracking & Deadline Alerts
 *
 * Adds contract-level date and period fields needed to anchor obligation
 * deadlines (e.g. defects liability start, notice cut-offs):
 *
 *   - start_date                    DATE nullable — contract commencement date
 *   - end_date                      DATE nullable — planned completion date
 *   - effective_date                DATE nullable — date contract takes legal effect
 *   - expiry_date                   DATE nullable — contract expiry / sunset date
 *   - notice_period_days            INTEGER nullable — contractual notice period
 *   - defects_liability_period_days INTEGER nullable — DLP duration in calendar days
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS.
 */
export class AddContractDateFields1748000000001 implements MigrationInterface {
  name = 'AddContractDateFields1748000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS start_date                    DATE         NULL,
        ADD COLUMN IF NOT EXISTS end_date                      DATE         NULL,
        ADD COLUMN IF NOT EXISTS effective_date                DATE         NULL,
        ADD COLUMN IF NOT EXISTS expiry_date                   DATE         NULL,
        ADD COLUMN IF NOT EXISTS notice_period_days            INTEGER      NULL,
        ADD COLUMN IF NOT EXISTS defects_liability_period_days INTEGER      NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        DROP COLUMN IF EXISTS defects_liability_period_days,
        DROP COLUMN IF EXISTS notice_period_days,
        DROP COLUMN IF EXISTS expiry_date,
        DROP COLUMN IF EXISTS effective_date,
        DROP COLUMN IF EXISTS end_date,
        DROP COLUMN IF EXISTS start_date;
    `);
  }
}
