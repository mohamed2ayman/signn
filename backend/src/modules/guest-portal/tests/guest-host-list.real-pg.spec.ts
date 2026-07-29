import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  Contract,
  GuestContractAccess,
  User,
  UserRole,
} from '../../../database/entities';
import { AuthService } from '../../auth/auth.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestAccessController } from '../controllers/guest-access.controller';
import { GuestAccessService } from '../services/guest-access.service';

/**
 * ⭐ #8c Part 4b — host guest-binding list (real Postgres).
 *
 * GET /guest-access/:contractId/guests — the read half of the 4a revoke: the
 * host's "who has access to my contract". Properties pinned here:
 *
 *  A. HOST-ONLY, ORG-WALLED. The list authorizes via findInOrg (revoke's
 *     exact wall) and NEVER via the guest binding path. The sharpest case: a
 *     caller who HOLDS a live binding on the contract but is not in the host
 *     org still gets the uniform 404 — a binding admits you to the guest
 *     surface, never to the host's management view.
 *
 *  B. REVOCATION-INCLUSIVE. Revoked bindings are returned WITH revoked_at /
 *     revoked_by_name (history the host is entitled to), live rows first.
 *     This is deliberately the OPPOSITE default from every guest-side read —
 *     the existence-oracle concern does not apply after the org wall.
 *
 *  C. SANITIZED PROJECTION. Identity + provenance as display names; no
 *     binding row ids, no granter/revoker UUIDs, no credential material.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-host-list] SKIPPING guest-host-list.real-pg.spec.ts: ' +
      'DATABASE_URL unset — the host list org-wall invariant MUST be ' +
      'proven against real Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(120_000);

describeReal('#8c Part 4b — host guest-binding list (real PG)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;

  const orgHostId = randomUUID();
  const orgOtherId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();

  const hostOwnerId = randomUUID();
  const otherHostId = randomUUID();
  const guestLiveId = randomUUID();
  const guestRevokedId = randomUUID();
  const managingAsGuestId = randomUUID();

  const contractWithGuestsId = randomUUID();
  const contractEmptyId = randomUUID();
  const otherOrgContractId = randomUUID();

  const bindingIds: string[] = [];
  let injectedUser: any;

  // Deterministic timestamps so the live-first / newest-first ordering is
  // assertable, not racy on same-millisecond CreateDateColumn defaults.
  const T0 = Date.parse('2026-07-01T10:00:00.000Z');
  const GRANT_LIVE = new Date(T0 + 3 * 3600_000); // newest grant (live)
  const GRANT_MANAGING = new Date(T0 + 2 * 3600_000); // older grant (live)
  const GRANT_REVOKED = new Date(T0 + 1 * 3600_000); // oldest grant (revoked)
  const REVOKED_AT = new Date(T0 + 4 * 3600_000);

  // GuestAccessService's constructor needs AuthService (session teardown on
  // revoke). The list path never touches it — assert that stays true.
  const authServiceStub = {
    revokeAllGuestSessions: jest.fn(async () => 0),
  };

  const HOST = () => ({
    id: hostOwnerId,
    role: UserRole.OWNER_ADMIN,
    organization_id: orgHostId,
    account_type: AccountType.MANAGING,
  });
  const OTHER_HOST = () => ({
    id: otherHostId,
    role: UserRole.OWNER_ADMIN,
    organization_id: orgOtherId,
    account_type: AccountType.MANAGING,
  });
  const BOUND_MANAGING = () => ({
    id: managingAsGuestId,
    role: UserRole.OWNER_ADMIN,
    organization_id: orgOtherId,
    account_type: AccountType.MANAGING,
  });
  const PURE_GUEST = () => ({
    id: guestLiveId,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

  const insertUser = async (
    id: string,
    email: string,
    firstName: string,
    lastName: string,
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
       VALUES ($1, $2, '$2a$10$hostlist.hash.sentinel.not.a.real.hash',
               $3, $4, $5, $6, $7,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, email, firstName, lastName, role, accountType, org],
    );
  };

  const insertBinding = async (
    userId: string,
    contractId: string,
    grantedBy: string | null,
    grantedAt: Date,
    revokedAt: Date | null = null,
    revokedBy: string | null = null,
  ) => {
    const id = randomUUID();
    bindingIds.push(id);
    await dataSource.query(
      `INSERT INTO guest_contract_access
         (id, user_id, contract_id, granted_by, granted_at, revoked_at, revoked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, contractId, grantedBy, grantedAt, revokedAt, revokedBy],
    );
    return id;
  };

  const listAs = (principal: any, contractId: string) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .get(`/guest-access/${contractId}/guests`)
      .set('Authorization', 'Bearer test-jwt');
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([Contract, GuestContractAccess, User]),
      ],
      controllers: [GuestAccessController],
      providers: [
        ContractAccessService,
        GuestAccessService,
        { provide: AuthService, useValue: authServiceStub },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!injectedUser) {
            throw new UnauthorizedException();
          }
          ctx.switchToHttp().getRequest().user = injectedUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so pipes behave as in production.
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = moduleRef.get(DataSource);

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)`,
      [orgHostId, 'HostList Host Org', orgOtherId, 'HostList Other Org'],
    );
    await insertUser(
      hostOwnerId,
      `hostlist-host-${hostOwnerId}@t.io`,
      'Hana',
      'Host',
      UserRole.OWNER_ADMIN,
      AccountType.MANAGING,
      orgHostId,
    );
    await insertUser(
      otherHostId,
      `hostlist-other-${otherHostId}@t.io`,
      'Omar',
      'Other',
      UserRole.OWNER_ADMIN,
      AccountType.MANAGING,
      orgOtherId,
    );
    await insertUser(
      guestLiveId,
      `hostlist-live-${guestLiveId}@t.io`,
      'Layla',
      'Live',
      UserRole.GUEST,
      AccountType.GUEST,
      null,
    );
    await insertUser(
      guestRevokedId,
      `hostlist-revoked-${guestRevokedId}@t.io`,
      'Rana',
      'Revoked',
      UserRole.GUEST,
      AccountType.GUEST,
      null,
    );
    await insertUser(
      managingAsGuestId,
      `hostlist-managing-${managingAsGuestId}@t.io`,
      'Moe',
      'Cross',
      UserRole.OWNER_ADMIN,
      AccountType.MANAGING,
      orgOtherId,
    );

    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        projectId,
        orgHostId,
        'HostList Project',
        hostOwnerId,
        otherProjectId,
        orgOtherId,
        'HostList Other Project',
        otherHostId,
      ],
    );
    for (const [cid, pid, name, creator] of [
      [contractWithGuestsId, projectId, 'HostList Shared Contract', hostOwnerId],
      [contractEmptyId, projectId, 'HostList Empty Contract', hostOwnerId],
      [otherOrgContractId, otherProjectId, 'HostList Foreign Contract', otherHostId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [cid, pid, name, creator],
      );
    }

    // Three bindings on the shared contract:
    //   live pure guest      (granted_by host owner, newest grant)
    //   live MANAGING-as-guest (granted_by NULL — granter deleted / unknown)
    //   REVOKED pure guest   (revoked by the host owner)
    await insertBinding(
      guestLiveId,
      contractWithGuestsId,
      hostOwnerId,
      GRANT_LIVE,
    );
    await insertBinding(
      managingAsGuestId,
      contractWithGuestsId,
      null,
      GRANT_MANAGING,
    );
    await insertBinding(
      guestRevokedId,
      contractWithGuestsId,
      hostOwnerId,
      GRANT_REVOKED,
      REVOKED_AT,
      hostOwnerId,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE id = ANY($1)`,
        [bindingIds],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractWithGuestsId, contractEmptyId, otherOrgContractId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectId, otherProjectId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [
          hostOwnerId,
          otherHostId,
          guestLiveId,
          guestRevokedId,
          managingAsGuestId,
        ],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgHostId, orgOtherId],
      ]);
    }
    await app?.close();
  });

  // ─── The happy path: identity + provenance + revoked state ──────────────

  describe('GET /guest-access/:contractId/guests — the host list', () => {
    it('⭐ returns every binding with identity, dates, and revoked state — live rows first', async () => {
      const res = await listAs(HOST(), contractWithGuestsId);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);

      // Ordering: live (newest grant first), then revoked.
      expect(res.body.map((r: any) => r.user_id)).toEqual([
        guestLiveId,
        managingAsGuestId,
        guestRevokedId,
      ]);

      const [live, managing, revoked] = res.body;

      expect(live).toEqual({
        user_id: guestLiveId,
        guest_email: `hostlist-live-${guestLiveId}@t.io`,
        guest_name: 'Layla Live',
        guest_account_type: AccountType.GUEST,
        granted_at: GRANT_LIVE.toISOString(),
        granted_by_name: 'Hana Host',
        revoked_at: null,
        revoked_by_name: null,
      });

      // MANAGING-as-guest surfaces its account_type (revoke's session-teardown
      // semantics differ per type) and a NULL granter stays null — never a
      // blank label, never a UUID.
      expect(managing).toEqual({
        user_id: managingAsGuestId,
        guest_email: `hostlist-managing-${managingAsGuestId}@t.io`,
        guest_name: 'Moe Cross',
        guest_account_type: AccountType.MANAGING,
        granted_at: GRANT_MANAGING.toISOString(),
        granted_by_name: null,
        revoked_at: null,
        revoked_by_name: null,
      });

      expect(revoked.user_id).toBe(guestRevokedId);
    });

    it('⭐ a revoked binding appears WITH revoked_at + revoked_by_name — it never vanishes', async () => {
      const res = await listAs(HOST(), contractWithGuestsId);
      expect(res.status).toBe(200);

      const revoked = res.body.find((r: any) => r.user_id === guestRevokedId);
      expect(revoked).toEqual({
        user_id: guestRevokedId,
        guest_email: `hostlist-revoked-${guestRevokedId}@t.io`,
        guest_name: 'Rana Revoked',
        guest_account_type: AccountType.GUEST,
        granted_at: GRANT_REVOKED.toISOString(),
        granted_by_name: 'Hana Host',
        revoked_at: REVOKED_AT.toISOString(),
        revoked_by_name: 'Hana Host',
      });
    });

    it('⭐ sanitized projection — no binding ids, no actor UUIDs, no credential material', async () => {
      const res = await listAs(HOST(), contractWithGuestsId);
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      // The binding rows' own ids never leave the server.
      for (const bid of bindingIds) {
        expect(raw).not.toContain(bid);
      }
      // Granter/revoker are NAMES only — the host owner's UUID must not
      // appear anywhere (it is granted_by AND revoked_by in the fixtures).
      expect(raw).not.toContain(hostOwnerId);
      // No password/hash fields ride along the user join.
      expect(raw.toLowerCase()).not.toContain('password');
      expect(raw).not.toContain('hostlist.hash.sentinel');
      // Exactly the documented projection keys — nothing extra.
      for (const row of res.body) {
        expect(Object.keys(row).sort()).toEqual([
          'granted_at',
          'granted_by_name',
          'guest_account_type',
          'guest_email',
          'guest_name',
          'revoked_at',
          'revoked_by_name',
          'user_id',
        ]);
      }
    });

    it('returns [] for an owned contract with no guests', async () => {
      const res = await listAs(HOST(), contractEmptyId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('the list path never touches session teardown', () => {
      expect(authServiceStub.revokeAllGuestSessions).not.toHaveBeenCalled();
    });
  });

  // ─── The org wall (host-only, never the binding path) ───────────────────

  describe('GET /guest-access/:contractId/guests — org wall', () => {
    it('a host in a DIFFERENT org cannot list — uniform 404', async () => {
      const res = await listAs(OTHER_HOST(), contractWithGuestsId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('⭐ a caller HOLDING a live binding still cannot list — the binding admits to the guest surface, never the host view', async () => {
      // managingAsGuest holds a LIVE binding on this exact contract, but its
      // org is not the host org → the org wall must reject regardless.
      const res = await listAs(BOUND_MANAGING(), contractWithGuestsId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('a pure guest (no org) gets 404 before any lookup', async () => {
      const res = await listAs(PURE_GUEST(), contractWithGuestsId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('a nonexistent contract id yields the same uniform 404', async () => {
      const res = await listAs(HOST(), randomUUID());
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('a non-UUID contract id is rejected 400 by ParseUUIDPipe', async () => {
      const res = await listAs(HOST(), 'not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('an unauthenticated request is rejected 401', async () => {
      injectedUser = null;
      const res = await request(app.getHttpServer())
        .get(`/guest-access/${contractWithGuestsId}/guests`)
        .set('Authorization', 'Bearer test-jwt');
      expect(res.status).toBe(401);
    });
  });
});
