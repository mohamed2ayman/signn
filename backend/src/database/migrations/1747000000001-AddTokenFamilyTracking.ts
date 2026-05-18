import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4.2 — JWT & Refresh Token Hardening
 *
 * Adds three columns to `user_sessions` for token family tracking and
 * Redis jti blacklist correlation:
 *
 *   - family_id          UUID — identifies a chain of rotated refresh tokens.
 *                                Each existing row becomes its own 1-row family.
 *                                On reuse-attack detection, every session sharing
 *                                a family_id is revoked atomically.
 *   - parent_token_hash  VARCHAR(64) — SHA-256 hex of the previous session's
 *                                token_hash in the rotation chain (NULL on
 *                                first login of a family).
 *   - jti                VARCHAR(36) — UUID claim from the access token issued
 *                                alongside this refresh token. Used by
 *                                SessionTrackingMiddleware to bump
 *                                last_active_at without hashing the bearer.
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
 */
export class AddTokenFamilyTracking1747000000001 implements MigrationInterface {
  name = 'AddTokenFamilyTracking1747000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto is required for gen_random_uuid() — most production
    // Postgres setups ship with it but enable defensively.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS family_id         UUID NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS parent_token_hash VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS jti               VARCHAR(36) NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_family_id
      ON user_sessions (family_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_jti
      ON user_sessions (jti)
      WHERE jti IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_sessions_jti`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_sessions_family_id`);
    await queryRunner.query(`
      ALTER TABLE user_sessions
        DROP COLUMN IF EXISTS jti,
        DROP COLUMN IF EXISTS parent_token_hash,
        DROP COLUMN IF EXISTS family_id;
    `);
  }
}
