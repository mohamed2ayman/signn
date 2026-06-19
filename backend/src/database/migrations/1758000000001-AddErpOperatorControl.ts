import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.28 v1.1 — Operator ERP connection control + circuit-breaker.
 *
 * Additive only. Adds an operator/system "hold" concept to erp_connections,
 * kept SEPARATE from the customer `enabled` switch and the engine `status`
 * health field:
 *   operator_hold_state  none | operator_suspended | auto_suspended
 *   hold_reason          why it was suspended (required by the API layer)
 *   hold_by_user_id      the SYSTEM_ADMIN who suspended (NULL for auto_suspended)
 *   hold_at              when the hold was placed
 *   consecutive_failures circuit-breaker counter (reset on success)
 *
 * Operability is derived: `enabled = true AND operator_hold_state = 'none'`.
 * The customer can clear `enabled` but NEVER the hold.
 *
 * Idempotent (`IF NOT EXISTS`), enum `_enum`-suffixed (lesson #143). Pure DDL —
 * transaction-safe, so no `transaction = false` override needed.
 */
export class AddErpOperatorControl1758000000001 implements MigrationInterface {
  name = 'AddErpOperatorControl1758000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'erp_operator_hold_enum') THEN
          CREATE TYPE erp_operator_hold_enum AS ENUM (
            'none', 'operator_suspended', 'auto_suspended'
          );
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE erp_connections
        ADD COLUMN IF NOT EXISTS operator_hold_state erp_operator_hold_enum NOT NULL DEFAULT 'none'
    `);
    await queryRunner.query(`
      ALTER TABLE erp_connections
        ADD COLUMN IF NOT EXISTS hold_reason TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE erp_connections
        ADD COLUMN IF NOT EXISTS hold_by_user_id UUID NULL
          REFERENCES users(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE erp_connections
        ADD COLUMN IF NOT EXISTS hold_at TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE erp_connections
        ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE erp_connections DROP COLUMN IF EXISTS consecutive_failures`);
    await queryRunner.query(`ALTER TABLE erp_connections DROP COLUMN IF EXISTS hold_at`);
    await queryRunner.query(`ALTER TABLE erp_connections DROP COLUMN IF EXISTS hold_by_user_id`);
    await queryRunner.query(`ALTER TABLE erp_connections DROP COLUMN IF EXISTS hold_reason`);
    await queryRunner.query(`ALTER TABLE erp_connections DROP COLUMN IF EXISTS operator_hold_state`);
    await queryRunner.query(`DROP TYPE IF EXISTS erp_operator_hold_enum`);
  }
}
