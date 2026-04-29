import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.3 — Admin Security Management
 *
 * Adds 5 tables to power the admin security panel:
 *   - security_policies      : singleton row (id = 'global') holding platform-wide policy
 *   - user_sessions          : per-(user, refresh-token) row, SHA-256 hashed JWT
 *   - known_devices          : trusted device fingerprints per user
 *   - password_history       : last N bcrypt hashes per user (reuse prevention)
 *   - blocked_ip_attempts    : log of requests rejected by IpFilterMiddleware
 *
 * Also adds a single column to `users`:
 *   - password_changed_at    : nullable timestamptz, backfilled to created_at
 *
 * Migration is idempotent — every table uses CREATE TABLE IF NOT EXISTS, and
 * the `security_policies` seed row uses INSERT ... ON CONFLICT DO NOTHING.
 */
export class AddAdminSecurityManagement1718000000001
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // ──────────────────────────────────────────────────────── users column
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMPTZ NULL;
    `);
    await queryRunner.query(`
      UPDATE "users" SET "password_changed_at" = "created_at"
        WHERE "password_changed_at" IS NULL;
    `);

    // ─────────────────────────────────────────────────── security_policies
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_policies" (
        "id"                            VARCHAR(20) PRIMARY KEY,
        "session_timeout_minutes"       INTEGER     NOT NULL DEFAULT 240,
        "password_min_length"           INTEGER     NOT NULL DEFAULT 8,
        "password_require_upper"        BOOLEAN     NOT NULL DEFAULT TRUE,
        "password_require_lower"        BOOLEAN     NOT NULL DEFAULT TRUE,
        "password_require_number"       BOOLEAN     NOT NULL DEFAULT TRUE,
        "password_require_symbol"       BOOLEAN     NOT NULL DEFAULT TRUE,
        "password_expiry_days"          INTEGER     NULL,
        "password_history_count"        INTEGER     NOT NULL DEFAULT 0,
        "lockout_max_attempts"          INTEGER     NOT NULL DEFAULT 5,
        "lockout_duration_minutes"      INTEGER     NOT NULL DEFAULT 30,
        "mfa_required_system_admin"     BOOLEAN     NOT NULL DEFAULT FALSE,
        "mfa_required_operations"       BOOLEAN     NOT NULL DEFAULT FALSE,
        "mfa_required_owner_admin"      BOOLEAN     NOT NULL DEFAULT FALSE,
        "ip_filter_enabled"             BOOLEAN     NOT NULL DEFAULT FALSE,
        "ip_allowlist"                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "ip_blocklist"                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "updated_by"                    UUID        NULL,
        "updated_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_security_policies_updated_by"
          FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    // Seed singleton row (idempotent)
    await queryRunner.query(`
      INSERT INTO "security_policies" ("id") VALUES ('global')
        ON CONFLICT ("id") DO NOTHING;
    `);

    // ───────────────────────────────────────────────────────── user_sessions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "id"                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id"             UUID         NOT NULL,
        "token_hash"          VARCHAR(64)  NOT NULL,
        "ip_address"          VARCHAR(64)  NULL,
        "user_agent"          TEXT         NULL,
        "device_type"         VARCHAR(16)  NOT NULL DEFAULT 'UNKNOWN',
        "browser"             VARCHAR(100) NULL,
        "os"                  VARCHAR(100) NULL,
        "location"            VARCHAR(200) NULL,
        "country_code"        VARCHAR(2)   NULL,
        "is_suspicious"       BOOLEAN      NOT NULL DEFAULT FALSE,
        "suspicious_reason"   VARCHAR(32)  NULL,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "last_active_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "expires_at"          TIMESTAMPTZ  NOT NULL,
        "revoked_at"          TIMESTAMPTZ  NULL,
        CONSTRAINT "fk_user_sessions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_user_sessions_device_type"
          CHECK ("device_type" IN ('DESKTOP','MOBILE','TABLET','UNKNOWN')),
        CONSTRAINT "ck_user_sessions_suspicious_reason"
          CHECK ("suspicious_reason" IS NULL OR
                 "suspicious_reason" IN ('NEW_COUNTRY','IMPOSSIBLE_TRAVEL','BRUTE_FORCE'))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_token_hash"
        ON "user_sessions" ("token_hash");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_user_expires"
        ON "user_sessions" ("user_id", "expires_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_user_country_created"
        ON "user_sessions" ("user_id", "country_code", "created_at");
    `);

    // ───────────────────────────────────────────────────────── known_devices
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "known_devices" (
        "id"               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id"          UUID         NOT NULL,
        "fingerprint"      VARCHAR(64)  NOT NULL,
        "ip_address"       VARCHAR(64)  NULL,
        "country_code"     VARCHAR(2)   NULL,
        "browser"          VARCHAR(100) NULL,
        "os"               VARCHAR(100) NULL,
        "first_seen_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "last_seen_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_known_devices_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_known_devices_user_fingerprint"
        ON "known_devices" ("user_id", "fingerprint");
    `);

    // ─────────────────────────────────────────────────────── password_history
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_history" (
        "id"               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id"          UUID         NOT NULL,
        "password_hash"    VARCHAR(255) NOT NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_password_history_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_password_history_user_created"
        ON "password_history" ("user_id", "created_at");
    `);

    // ───────────────────────────────────────────────────── blocked_ip_attempts
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "blocked_ip_attempts" (
        "id"                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ip_address"        VARCHAR(64)  NOT NULL,
        "attempted_email"   VARCHAR(255) NULL,
        "reason"            VARCHAR(32)  NOT NULL,
        "user_agent"        TEXT         NULL,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "ck_blocked_ip_attempts_reason"
          CHECK ("reason" IN ('BLOCKLIST', 'NOT_IN_ALLOWLIST'))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_blocked_ip_attempts_created"
        ON "blocked_ip_attempts" ("created_at");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_blocked_ip_attempts_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "blocked_ip_attempts";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_password_history_user_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "password_history";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_known_devices_user_fingerprint";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "known_devices";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_user_country_created";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_user_expires";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_token_hash";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_policies";`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_changed_at";`,
    );
  }
}
