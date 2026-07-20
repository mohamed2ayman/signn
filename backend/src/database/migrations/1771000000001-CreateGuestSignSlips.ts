import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest Signing v1 — the SLIP capability table.
 *
 * A per-(guest, contract) record that authorizes signing. Default-deny: a
 * bare guest_contract_access binding NEVER implies signing — a slip is
 * created ONLY by explicit host action and consumed by the guest sign door
 * (binding + slip, atomic, uniform 404 on either miss).
 *
 * Columns:
 *   status                 PENDING → ACCEPTED → EXECUTED / DECLINED (reserved,
 *                          never set in v1) / VOIDED. varchar + TS enum, NOT a
 *                          PG enum (guest_invitations precedent).
 *   accepted_version_id /  captured from the PinResult at execution — works
 *   accepted_content_hash  for a fresh pin AND the already-pinned no-op.
 *   envelope_id            RESERVED for v2 DocuSign — created now, NEVER
 *                          populated by v1 code.
 *
 * Partial unique index: ONE non-terminal slip per (contract, grantee) —
 * status IN ('PENDING','ACCEPTED'). Terminal rows (EXECUTED/VOIDED/DECLINED)
 * do not block a future re-issue.
 *
 * Additive-only, IF NOT EXISTS, no backfill, no EXCEPTION WHEN blocks
 * (lessons #31/#103/#111). Timestamp strictly greater than 1770000000004.
 */
export class CreateGuestSignSlips1771000000001 implements MigrationInterface {
  name = 'CreateGuestSignSlips1771000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guest_sign_slips" (
        "id"                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "contract_id"           uuid NOT NULL,
        "grantee_user_id"       uuid NOT NULL,
        "granted_by"            uuid NULL,
        "granted_at"            timestamptz NOT NULL DEFAULT now(),
        "status"                varchar(20) NOT NULL DEFAULT 'PENDING',
        "accepted_at"           timestamptz NULL,
        "accepted_version_id"   uuid NULL,
        "accepted_content_hash" varchar(64) NULL,
        "envelope_id"           varchar(255) NULL,
        "voided_at"             timestamptz NULL,
        "voided_by"             uuid NULL
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gss_contract') THEN
          ALTER TABLE "guest_sign_slips"
            ADD CONSTRAINT "fk_gss_contract"
            FOREIGN KEY ("contract_id") REFERENCES "contracts" ("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gss_grantee') THEN
          ALTER TABLE "guest_sign_slips"
            ADD CONSTRAINT "fk_gss_grantee"
            FOREIGN KEY ("grantee_user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gss_granted_by') THEN
          ALTER TABLE "guest_sign_slips"
            ADD CONSTRAINT "fk_gss_granted_by"
            FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gss_accepted_version') THEN
          ALTER TABLE "guest_sign_slips"
            ADD CONSTRAINT "fk_gss_accepted_version"
            FOREIGN KEY ("accepted_version_id") REFERENCES "contract_versions" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gss_voided_by') THEN
          ALTER TABLE "guest_sign_slips"
            ADD CONSTRAINT "fk_gss_voided_by"
            FOREIGN KEY ("voided_by") REFERENCES "users" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guest_sign_slips_contract_id"
        ON "guest_sign_slips" ("contract_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guest_sign_slips_grantee_user_id"
        ON "guest_sign_slips" ("grantee_user_id")
    `);
    // ONE non-terminal slip per (contract, grantee).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_guest_sign_slips_active"
        ON "guest_sign_slips" ("contract_id", "grantee_user_id")
        WHERE "status" IN ('PENDING', 'ACCEPTED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guest_sign_slips"`);
  }
}
