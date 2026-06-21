import { MigrationInterface, QueryRunner } from 'typeorm';
import { CryptoService } from '../../common/utils/crypto';

/**
 * Phase 7.35 — encrypt existing plaintext `users.mfa_totp_secret` at rest.
 *
 * Forward-only. Converts any still-plaintext TOTP secret into a CryptoService
 * AES-256-GCM `v1.` payload (PR #73), matching the runtime encrypt-on-write path
 * in AuthService.
 *
 * Idempotent + half-run-safe: only rows whose secret is NOT already a `v1.`
 * payload are selected (`NOT LIKE 'v1.%'`), so re-running — or resuming a
 * partially-applied run — never double-encrypts an already-converted value.
 *
 * Do-no-harm: the SELECT runs first; if there is nothing to convert the key is
 * not needed and the migration is a clean no-op. When there ARE rows, the key is
 * validated (via CryptoService.encrypt, which throws a clear `ERP_CREDENTIAL_ENC_KEY`
 * error if it is missing/short) BEFORE any UPDATE — so a missing key aborts the
 * migration with ZERO rows modified.
 *
 * The migration constructs its own CryptoService with a ConfigService shim
 * reading `process.env` (data-source.ts loads dotenv before migrations run),
 * mirroring how the ERP integration spec builds it — the AES-GCM logic is NEVER
 * reimplemented in SQL.
 */
export class EncryptMfaTotpSecrets1759000000001 implements MigrationInterface {
  name = 'EncryptMfaTotpSecrets1759000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const crypto = new CryptoService({
      get: (key: string) => process.env[key],
    } as unknown as ConstructorParameters<typeof CryptoService>[0]);

    // Select ONLY still-plaintext secrets. Already-encrypted (`v1.…`) rows are
    // skipped, making this idempotent and safe to re-run / resume.
    const rows: Array<{ id: string; mfa_totp_secret: string }> =
      await queryRunner.query(
        `SELECT id, mfa_totp_secret FROM users
         WHERE mfa_totp_secret IS NOT NULL AND mfa_totp_secret NOT LIKE 'v1.%'`,
      );

    if (rows.length === 0) {
      return; // nothing to convert — key not required, clean no-op
    }

    for (const row of rows) {
      // encrypt() validates the key and throws BEFORE the UPDATE runs, so a
      // missing/short key leaves every row unmodified (do-no-harm).
      const encrypted = crypto.encrypt(row.mfa_totp_secret);
      await queryRunner.query(
        `UPDATE users SET mfa_totp_secret = $1 WHERE id = $2`,
        [encrypted, row.id],
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally irreversible: decrypting at-rest secrets back to plaintext is
    // a security regression. This migration is forward-only.
    // eslint-disable-next-line no-console
    console.log(
      '[migration] EncryptMfaTotpSecrets1759000000001 is forward-only — down() is a no-op.',
    );
  }
}
