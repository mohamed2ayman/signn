import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4.2 — retire `users.refresh_token_hash`.
 *
 * Refresh tokens have lived in `user_sessions.token_hash` since the
 * Phase 3.3 admin-security migration. The `users.refresh_token_hash`
 * column was the pre-3.3 single-token store and is now dual-storage
 * technical debt — every login wrote to it but no read path other than
 * `auth.service.refreshToken()` consulted it.
 *
 * Phase 4.2 refreshToken() now relies exclusively on the UserSession
 * row (looked up by SHA-256 of the raw refresh JWT) for validation,
 * so this column is safe to drop.
 *
 * Idempotent — DROP COLUMN IF EXISTS.
 */
export class RemoveLegacyRefreshTokenHash1747000000002
  implements MigrationInterface
{
  name = 'RemoveLegacyRefreshTokenHash1747000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS refresh_token_hash;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS refresh_token_hash VARCHAR(255) NULL;
    `);
  }
}
