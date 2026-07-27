import { TestingModule, Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID, createHash } from 'crypto';

/**
 * ⭐ #8c Part 4a (Checkpoint C) — session teardown on binding revocation.
 *
 * The read filter already 404s every resource the instant a binding is
 * revoked. This is the SECOND layer: end the revoked party's session rather
 * than leaving an already-issued access token technically valid for the rest
 * of its TTL (JwtStrategy checks Redis per request, never the DB — so DB
 * revocation ALONE does not stop a live access token).
 *
 * Proven here against the REAL Postgres + REAL Redis via a booted AppModule,
 * because every interesting property is about the interaction between the two:
 *
 *   1. PURE GUEST → full teardown. Every session row revoked AND every jti
 *      blacklisted in Redis.
 *   2. ⭐ MULTI-SESSION (the half-state risk). `issueGuestSession` mints a NEW
 *      family per establish-identity, so a guest who returned via their link
 *      more than once holds SEVERAL families. A family-scoped teardown would
 *      revoke one and leave the rest alive. Asserted: ALL families die
 *      together, none left half-torn-down.
 *   3. ⭐ THE TTL TRAP. A pure guest's access token is minted with
 *      JWT_GUEST_ACCESS_EXPIRES_IN (~1h), not the global 15m. Blacklisting for
 *      15m would let the Redis entry expire ~45 min BEFORE the token, and the
 *      revoked guest's token would start working again. Asserted: each
 *      blacklist TTL outlives the guest token lifetime.
 *   4. MANAGING-as-guest → NOT torn down. Their session belongs to their own
 *      organisation; the host revoking a share does not get to end it. They
 *      rely on the read filter alone. (Deliberate asymmetry, not an omission.)
 *   5. RE-ENTRY still works: teardown revokes SESSIONS only — it never touches
 *      the user row, the password, or any other binding — so the guest can
 *      re-establish via a link for a contract they are still bound to.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-revoke-session-teardown] SKIPPING — DATABASE_URL unset. The ' +
      'teardown invariants MUST be proven against real Postgres + Redis.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(180_000);

const setEnvDefault = (k: string, v: string) => {
  if (!process.env[k]) process.env[k] = v;
};

describeReal('#8c Part 4a — guest session teardown on revoke (real PG + Redis)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let authService: any;
  let blacklist: any;

  const guestId = randomUUID();
  const managingId = randomUUID();
  const orgId = randomUUID();
  const sessionIds: string[] = [];

  // Two DISTINCT families for the guest — the multi-session case.
  const familyA = randomUUID();
  const familyB = randomUUID();
  const jtiA1 = randomUUID();
  const jtiA2 = randomUUID();
  const jtiB1 = randomUUID();
  const jtiM1 = randomUUID();

  const insertUser = async (
    id: string,
    email: string,
    role: string,
    accountType: string,
    org: string | null,
  ) => {
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       )
       VALUES ($1, $2, '$2a$10$teardown.hash.sentinel.not.a.real.hashxxx',
               'Teardown', 'Fixture', $3, $4, $5,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, email, role, accountType, org],
    );
  };

  const insertSession = async (
    userId: string,
    familyId: string,
    jti: string,
  ) => {
    const id = randomUUID();
    sessionIds.push(id);
    // token_hash mirrors SessionService.hashToken (sha256 hex of the raw JWT).
    const tokenHash = createHash('sha256').update(`raw-${jti}`).digest('hex');
    await dataSource.query(
      `INSERT INTO user_sessions
         (id, user_id, token_hash, family_id, jti, expires_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + interval '7 days', NOW())`,
      [id, userId, tokenHash, familyId, jti],
    );
    return id;
  };

  beforeAll(async () => {
    setEnvDefault('REDIS_URL', 'redis://localhost:6379');
    setEnvDefault('JWT_SECRET', 'teardown-test-jwt-secret-min-16-chars');
    setEnvDefault(
      'JWT_REFRESH_SECRET',
      'teardown-test-jwt-refresh-secret-min-32-characters-xx',
    );
    setEnvDefault('NESTJS_INTERNAL_TOKEN', 'teardown-test-internal-token');
    setEnvDefault('FRONTEND_URL', 'http://localhost:5173');
    setEnvDefault('BASE_URL', 'http://localhost:3000');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../../../app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AuthService } = require('../../auth/auth.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      TokenBlacklistService,
    } = require('../../../common/services/token-blacklist.service');

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    authService = moduleRef.get(AuthService);
    blacklist = moduleRef.get(TokenBlacklistService);

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgId, 'Teardown Org'],
    );
    await insertUser(
      guestId,
      `teardown-guest-${guestId}@t.io`,
      'GUEST',
      'GUEST',
      null,
    );
    await insertUser(
      managingId,
      `teardown-managing-${managingId}@t.io`,
      'OWNER_ADMIN',
      'MANAGING',
      orgId,
    );

    // Guest: TWO families (returned via their link twice), 3 sessions total.
    await insertSession(guestId, familyA, jtiA1);
    await insertSession(guestId, familyA, jtiA2);
    await insertSession(guestId, familyB, jtiB1);
    // Managing user: one session that must SURVIVE.
    await insertSession(managingId, randomUUID(), jtiM1);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM user_sessions WHERE id = ANY($1)`, [
        sessionIds,
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [guestId, managingId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await moduleRef?.close();
  });

  it('sanity — all four sessions start live and no jti is blacklisted', async () => {
    const rows = await dataSource.query(
      `SELECT count(*)::int n FROM user_sessions
        WHERE id = ANY($1) AND revoked_at IS NULL`,
      [sessionIds],
    );
    expect(rows[0].n).toBe(4);
    for (const jti of [jtiA1, jtiA2, jtiB1, jtiM1]) {
      await expect(blacklist.isBlacklisted(jti)).resolves.toBe(false);
    }
  });

  it('⭐ PURE GUEST teardown kills EVERY family at once — no half-state', async () => {
    const revoked = await authService.revokeAllGuestSessions(guestId);
    expect(revoked).toBe(3);

    // DB: all three guest sessions revoked, across BOTH families.
    const live = await dataSource.query(
      `SELECT family_id FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [guestId],
    );
    expect(live).toHaveLength(0);

    const perFamily = await dataSource.query(
      `SELECT family_id, count(*)::int n FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NOT NULL
        GROUP BY family_id ORDER BY family_id`,
      [guestId],
    );
    // Both families torn down — a family-scoped teardown would have left one.
    expect(perFamily).toHaveLength(2);
    expect(perFamily.reduce((a: number, r: any) => a + r.n, 0)).toBe(3);
  });

  it('⭐ every guest jti is blacklisted in Redis (DB revocation alone would not stop a live access token)', async () => {
    for (const jti of [jtiA1, jtiA2, jtiB1]) {
      await expect(blacklist.isBlacklisted(jti)).resolves.toBe(true);
    }
  });

  it('⭐ the blacklist TTL outlives the GUEST token lifetime (not the 15m global)', async () => {
    // The trap: blacklisting with JWT_ACCESS_EXPIRES_IN (15m = 900s) while the
    // guest token lives ~1h (3600s) would un-blacklist it 45 min early.
    const redis = (blacklist as any).redis;
    const ttl = await redis.ttl(`blacklist:jti:${jtiA1}`);
    expect(ttl).toBeGreaterThan(900);
    expect(ttl).toBeGreaterThanOrEqual(3500);
  });

  it('MANAGING-as-guest session SURVIVES — their own-org session is not the host’s to end', async () => {
    const [row] = await dataSource.query(
      `SELECT revoked_at FROM user_sessions WHERE user_id = $1`,
      [managingId],
    );
    expect(row.revoked_at).toBeNull();
    await expect(blacklist.isBlacklisted(jtiM1)).resolves.toBe(false);
  });

  it('⭐ RE-ENTRY is possible: teardown touched SESSIONS only — the user row and credentials are intact', async () => {
    const [user] = await dataSource.query(
      `SELECT is_active, password_hash, account_type, locked_until,
              failed_login_attempts
         FROM users WHERE id = $1`,
      [guestId],
    );
    // Nothing that would block re-establishing via a link for a contract the
    // guest is STILL bound to: account live, password unchanged, not locked.
    expect(user.is_active).toBe(true);
    expect(user.password_hash).toBe(
      '$2a$10$teardown.hash.sentinel.not.a.real.hashxxx',
    );
    expect(user.account_type).toBe('GUEST');
    expect(user.locked_until).toBeNull();
    expect(user.failed_login_attempts).toBe(0);

    // And a NEW session for the same user is unaffected by the teardown —
    // proving the revoke is a point-in-time action, not a standing ban.
    const newJti = randomUUID();
    await insertSession(guestId, randomUUID(), newJti);
    const [fresh] = await dataSource.query(
      `SELECT revoked_at FROM user_sessions WHERE jti = $1`,
      [newJti],
    );
    expect(fresh.revoked_at).toBeNull();
    await expect(blacklist.isBlacklisted(newJti)).resolves.toBe(false);
  });
});
