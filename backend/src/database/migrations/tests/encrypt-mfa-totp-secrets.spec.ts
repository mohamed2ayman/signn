import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';

import { CryptoService } from '../../../common/utils/crypto';
import { EncryptMfaTotpSecrets1759000000001 } from '../1759000000001-EncryptMfaTotpSecrets';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Needs real Postgres (DATABASE_URL set). CI is unit-test ONLY (CLAUDE.md), so
// skip LOUDLY when unset — a silent skip would read green without proving the
// data migration actually converts plaintext rows.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[7.35] SKIPPING real-Postgres spec (encrypt-mfa-totp-secrets): DATABASE_URL ' +
      'unset — this MUST run against Postgres to prove the migration encrypts ' +
      'plaintext mfa_totp_secret idempotently. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const ENC_KEY = 'mfa-totp-migration-test-key-0123456789AB'; // >= 32 chars

describeReal('EncryptMfaTotpSecrets migration (real Postgres)', () => {
  let dataSource: DataSource;
  let crypto: CryptoService;
  const migration = new EncryptMfaTotpSecrets1759000000001();
  const createdUserIds: string[] = [];
  const ORIGINAL_KEY = process.env.ERP_CREDENTIAL_ENC_KEY;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');
    // This spec runs ONLY raw SQL (queryRunner.query) — no entity metadata or
    // migration registry is needed. Override the glob `entities`/`migrations`
    // paths to skip TypeORM's directory scan, which otherwise lazily imports
    // files and races with Jest teardown ("import after environment torn down").
    dataSource = new DataSource({ ...dataSourceOptions, entities: [], migrations: [] });
    await dataSource.initialize();
    crypto = new CryptoService({
      get: (k: string) => (k === 'ERP_CREDENTIAL_ENC_KEY' ? ENC_KEY : undefined),
    } as unknown as ConstructorParameters<typeof CryptoService>[0]);
  });

  afterAll(async () => {
    if (createdUserIds.length && dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
    }
    await dataSource?.destroy();
    // Restore the key the suite may have mutated.
    if (ORIGINAL_KEY === undefined) delete process.env.ERP_CREDENTIAL_ENC_KEY;
    else process.env.ERP_CREDENTIAL_ENC_KEY = ORIGINAL_KEY;
  });

  /** Insert a minimal MFA-TOTP user with the given stored secret; returns its id. */
  async function insertUser(secretValue: string): Promise<string> {
    const id = randomUUID();
    createdUserIds.push(id);
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, mfa_method, mfa_totp_secret,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1, $2, $3, 'Mfa', 'Test', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, TRUE, 'totp', $4,
                 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, `mfa-mig-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.value.mfa', secretValue],
    );
    return id;
  }

  async function readSecret(id: string): Promise<string> {
    const [row] = await dataSource.query(
      `SELECT mfa_totp_secret FROM users WHERE id = $1`,
      [id],
    );
    return row.mfa_totp_secret;
  }

  it('converts a plaintext secret to a v1. payload that decrypts to the original; idempotent on re-run', async () => {
    process.env.ERP_CREDENTIAL_ENC_KEY = ENC_KEY;
    const secret = authenticator.generateSecret();
    const id = await insertUser(secret);

    // First run — plaintext → encrypted.
    const runner1 = dataSource.createQueryRunner();
    await runner1.connect();
    await migration.up(runner1);
    await runner1.release();

    const afterFirst = await readSecret(id);
    expect(afterFirst.startsWith('v1.')).toBe(true);
    expect(crypto.decrypt(afterFirst)).toBe(secret);
    // The decrypted secret still verifies a freshly-generated TOTP token.
    expect(
      authenticator.verify({ token: authenticator.generate(secret), secret: crypto.decrypt(afterFirst) }),
    ).toBe(true);

    // Second run — idempotent: the already-v1. value is left byte-for-byte
    // unchanged (NOT re-encrypted into a double payload).
    const runner2 = dataSource.createQueryRunner();
    await runner2.connect();
    await migration.up(runner2);
    await runner2.release();

    const afterSecond = await readSecret(id);
    expect(afterSecond).toBe(afterFirst);
    expect(crypto.decrypt(afterSecond)).toBe(secret);
  });

  it('leaves an already-encrypted (v1.) row untouched', async () => {
    process.env.ERP_CREDENTIAL_ENC_KEY = ENC_KEY;
    const secret = authenticator.generateSecret();
    const preEncrypted = crypto.encrypt(secret);
    const id = await insertUser(preEncrypted);

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await migration.up(runner);
    await runner.release();

    expect(await readSecret(id)).toBe(preEncrypted); // unchanged
  });

  it('throws and modifies ZERO rows when ERP_CREDENTIAL_ENC_KEY is missing', async () => {
    delete process.env.ERP_CREDENTIAL_ENC_KEY;
    const secret = authenticator.generateSecret();
    const id = await insertUser(secret); // plaintext

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await expect(migration.up(runner)).rejects.toThrow(/ERP_CREDENTIAL_ENC_KEY/);
    await runner.release();

    // Do-no-harm: the plaintext row is unchanged (never half-converted).
    expect(await readSecret(id)).toBe(secret);
  });
});
