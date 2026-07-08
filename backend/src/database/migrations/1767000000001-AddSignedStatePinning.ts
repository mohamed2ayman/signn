import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Signed-state pinning — Slice 1 (CAPTURE).
 *
 * Once a contract is executed (via the DocuSign completed webhook OR the manual
 * "Mark as signed" action) its legal content is frozen: a version snapshot is
 * taken and a SHA-256 hash of the canonical payload (clauses + substantive
 * metadata) is pinned.
 *
 *  - contract_versions.content_hash — SHA-256 hex (64 chars) of the canonical
 *    pin payload. NULL on all non-pinned versions.
 *  - contracts.pinned_version_id — pointer to the pinned ContractVersion.
 *    FK is ON DELETE RESTRICT deliberately: a pinned version row is the legal
 *    record of what was signed and must never be silently deletable while a
 *    contract points at it.
 *  - contracts.pinned_at — when the pin was taken.
 *  - contracts.pinned_content_hash — denormalized copy of the pinned version's
 *    content_hash so integrity checks don't need the join.
 *
 * Additive only, no backfill — no signed contracts exist yet.
 * Idempotent: ADD COLUMN IF NOT EXISTS + pg_constraint existence check
 * (never EXCEPTION WHEN — lessons #31/#103/#111).
 */
export class AddSignedStatePinning1767000000001 implements MigrationInterface {
  name = 'AddSignedStatePinning1767000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contract_versions
      ADD COLUMN IF NOT EXISTS "content_hash" varchar(64) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS "pinned_version_id" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz NULL
    `);
    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS "pinned_content_hash" varchar(64) NULL
    `);

    // PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS — pg_constraint check
    // is the canonical idempotent form (Phase 7.9 pattern).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_contracts_pinned_version'
        ) THEN
          ALTER TABLE contracts
          ADD CONSTRAINT fk_contracts_pinned_version
          FOREIGN KEY (pinned_version_id) REFERENCES contract_versions(id)
          ON DELETE RESTRICT;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_pinned_version
    `);
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS "pinned_content_hash"
    `);
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS "pinned_at"
    `);
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS "pinned_version_id"
    `);
    await queryRunner.query(`
      ALTER TABLE contract_versions DROP COLUMN IF EXISTS "content_hash"
    `);
  }
}
