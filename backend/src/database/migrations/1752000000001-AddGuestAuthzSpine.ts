import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — Bucket 1a: Guest Authorization Spine
 *
 * Three changes, all idempotent:
 *
 * 1. Add the `account_type` enum + column on `users`. Defaults to 'MANAGING'
 *    for both existing rows (backfilled by the `DEFAULT` clause) and new
 *    inserts — so the platform's behaviour for normal users is unchanged.
 *
 * 2. Add the 'GUEST' value to the existing `user_role` enum so the
 *    new restricted role can be stored.
 *
 *    NOTE — the InitialSchema migration (1710000000000) named this type
 *    `user_role` (singular table prefix, no `_enum` suffix) BEFORE the
 *    lesson #143 convention (`<table>_<column>_enum`) was established.
 *    The actual on-disk type name is what matters here, not the rule.
 *
 *    `ALTER TYPE ADD VALUE` cannot run inside a transaction block on
 *    PostgreSQL < 14, so this migration sets `transaction = false`.
 *
 * 3. Create the `guest_contract_access` binding table. Storage only —
 *    this migration does not build the invite flow (bucket 1b). The
 *    table is what `ContractAccessService` reads to decide whether a
 *    guest may access a specific contract.
 *
 * No EXCEPTION WHEN blocks (lessons #31, #103, #111). All DDL is
 * idempotent via IF NOT EXISTS or pg_type / pg_constraint guards.
 */
export class AddGuestAuthzSpine1752000000001 implements MigrationInterface {
  name = 'AddGuestAuthzSpine1752000000001';

  // Must be false — ALTER TYPE ADD VALUE cannot run inside a transaction
  // block on PostgreSQL < 14 (lessons #103, #111, #143).
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. account_type enum + column ────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_account_type_enum') THEN
          CREATE TYPE users_account_type_enum AS ENUM ('MANAGING', 'GUEST', 'FREE');
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS account_type users_account_type_enum
          NOT NULL
          DEFAULT 'MANAGING'
    `);

    // ─── 2. GUEST role on the existing user_role enum ─────────────────
    // The type was named `user_role` by the InitialSchema migration —
    // see this file's header note. Do NOT rename to users_role_enum;
    // that would break.
    await queryRunner.query(
      `ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'GUEST'`,
    );

    // ─── 3. guest_contract_access binding table ───────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guest_contract_access (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        contract_id  UUID NOT NULL
          REFERENCES contracts(id) ON DELETE CASCADE,
        granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        granted_by   UUID NULL
          REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_guest_contract_access_user_contract
          UNIQUE (user_id, contract_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_contract_access_user_id
        ON guest_contract_access (user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_contract_access_contract_id
        ON guest_contract_access (contract_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the binding table + indexes.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_guest_contract_access_contract_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_guest_contract_access_user_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS guest_contract_access`);

    // Drop the account_type column and its enum type.
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS account_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS users_account_type_enum`);

    // PostgreSQL does not support removing enum values once added —
    // 'GUEST' stays on user_role after down(). No-op for that.
  }
}
