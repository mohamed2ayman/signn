import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — Bucket 1b-i: Guest invitations + pre-password viewer.
 *
 * One change, idempotent:
 *
 * 1. Create the `guest_invitation_status_enum` enum + `guest_invitations`
 *    table. Storage only — the invitation token is HMAC-signed and verified
 *    against this row in InvitationTokenService.
 *
 * No `ALTER TYPE ADD VALUE` statements here, so this migration runs in the
 * default transactional mode. No EXCEPTION WHEN blocks (lessons #31, #103,
 * #111). All DDL is idempotent via IF NOT EXISTS or pg_type guards.
 *
 * Lesson #143 follow-through: the enum type name uses TypeORM's
 * `<table>_<column>_enum` convention so future migrations or schema-asserts
 * can locate it predictably.
 */
export class AddGuestInvitations1752000000002 implements MigrationInterface {
  name = 'AddGuestInvitations1752000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. status enum ───────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guest_invitations_status_enum') THEN
          CREATE TYPE guest_invitations_status_enum
            AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
        END IF;
      END $$
    `);

    // ─── 2. guest_invitations table ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guest_invitations (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id      UUID NOT NULL
          REFERENCES contracts(id) ON DELETE CASCADE,
        invited_email    VARCHAR(255) NOT NULL,
        invited_language VARCHAR(10) NOT NULL DEFAULT 'en',
        status           guest_invitations_status_enum NOT NULL DEFAULT 'PENDING',
        expires_at       TIMESTAMPTZ NOT NULL,
        revoked_at       TIMESTAMPTZ NULL,
        accepted_at      TIMESTAMPTZ NULL,
        created_by       UUID NULL
          REFERENCES users(id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_contract_id
        ON guest_invitations (contract_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_invited_email
        ON guest_invitations (invited_email)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_status_expires_at
        ON guest_invitations (status, expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_guest_invitations_status_expires_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_guest_invitations_invited_email`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_guest_invitations_contract_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS guest_invitations`);
    await queryRunner.query(`DROP TYPE IF EXISTS guest_invitations_status_enum`);
  }
}
