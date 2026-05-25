import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.2-E — Corrective migration for obligation_status enum.
 *
 * Context: Migration 1718000000002-AddComplianceMonitoring.ts was supposed
 * to add MET and WAIVED to the obligation_status enum but used the wrong
 * type name (`obligations_status_enum` instead of `obligation_status`).
 * The EXCEPTION WHEN undefined_object catch swallowed the failure silently.
 * Every database that ran 1718000000002 is missing both values.
 *
 * Fix: Run the correct ALTER TYPE statements here. IF NOT EXISTS makes this
 * safe on:
 *   - Unpatched DBs (most environments)  → values added
 *   - Manually patched DBs (local dev)   → IF NOT EXISTS skips safely
 *   - Fresh rebuilds from scratch         → handled by fixed 1718000000002
 *
 * transaction = false is required: PostgreSQL < 14 does not allow
 * ALTER TYPE ADD VALUE inside a transaction block.
 */
export class FixObligationStatusEnum1748000000004 implements MigrationInterface {
  name = 'FixObligationStatusEnum1748000000004';

  // Must be false — ALTER TYPE ADD VALUE cannot run inside a transaction
  // block on PostgreSQL < 14. Set explicitly for cross-version portability.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE obligation_status ADD VALUE IF NOT EXISTS 'MET'`,
    );
    await queryRunner.query(
      `ALTER TYPE obligation_status ADD VALUE IF NOT EXISTS 'WAIVED'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values once added.
    // A full rollback would require DROP TYPE + recreate without the values,
    // which risks data loss on any row with status = MET or WAIVED.
    // No-op intentional.
  }
}
