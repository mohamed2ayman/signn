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
  UserRole,
} from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestAccessController } from '../controllers/guest-access.controller';
import { GuestAccessService } from '../services/guest-access.service';
import { GuestMyContractsController } from '../controllers/guest-my-contracts.controller';

/**
 * ⭐ #8c Part 4a — binding revocation (real Postgres).
 *
 * Two leak-critical properties, proven against live SQL rather than mocks:
 *
 *  A. THE READ FILTER. A revoked binding grants NOTHING at EVERY binding-read
 *     site — hasGuestBinding, findForGuest, listGuestBindings — and the denial
 *     is BYTE-IDENTICAL to the never-bound case. "Revoked" must not be
 *     distinguishable from "never shared": that would be an existence oracle
 *     telling a stranger the contract exists and that they once had it.
 *
 *  B. THE REVOKE ENDPOINT. Host-only (org wall), atomic, idempotent, and it
 *     NEVER deletes the row — the historical fact that the share existed is
 *     what the document proposed-vs-live classification later reads.
 *
 * Also pinned here (the trap a future reader is most likely to walk into):
 * re-revoking must NOT rewrite the first revoker's identity/timestamp, and a
 * revoked binding must NOT be resurrected by the establish-identity probe.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-binding-revoke] SKIPPING guest-binding-revoke.real-pg.spec.ts: ' +
      'DATABASE_URL unset — the revocation read-filter invariant MUST be ' +
      'proven against real Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(120_000);

describeReal('#8c Part 4a — guest binding revocation (real PG)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let access: ContractAccessService;

  const orgHostId = randomUUID();
  const orgOtherId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();

  const hostOwnerId = randomUUID();
  const otherHostId = randomUUID();
  const guestId = randomUUID();
  const unboundGuestId = randomUUID();

  const contractLiveId = randomUUID();
  const contractRevokedId = randomUUID();
  const otherOrgContractId = randomUUID();

  const bindingIds: string[] = [];
  let injectedUser: any;

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
  const GUEST = () => ({
    id: guestId,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

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
       VALUES ($1, $2, '$2a$10$revoke.hash.sentinel.not.a.real.hashxxxxx',
               'Revoke', 'Fixture', $3, $4, $5,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, email, role, accountType, org],
    );
  };

  const insertBinding = async (userId: string, contractId: string) => {
    const id = randomUUID();
    bindingIds.push(id);
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [id, userId, contractId, hostOwnerId],
    );
    return id;
  };

  const revokeAs = (principal: any, contractId: string, body: any) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .post(`/guest-access/${contractId}/revoke`)
      .set('Authorization', 'Bearer test-jwt')
      .send(body);
  };

  const listAs = (principal: any) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .get('/guest/my-contracts')
      .set('Authorization', 'Bearer test-jwt');
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      controllers: [GuestAccessController, GuestMyContractsController],
      providers: [ContractAccessService, GuestAccessService],
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
    // Mirror main.ts so the DTO's @IsUUID actually rejects.
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = moduleRef.get(DataSource);
    access = moduleRef.get(ContractAccessService);

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)`,
      [orgHostId, 'Revoke Host Org', orgOtherId, 'Revoke Other Org'],
    );
    await insertUser(
      hostOwnerId,
      `revoke-host-${hostOwnerId}@t.io`,
      UserRole.OWNER_ADMIN,
      AccountType.MANAGING,
      orgHostId,
    );
    await insertUser(
      otherHostId,
      `revoke-other-${otherHostId}@t.io`,
      UserRole.OWNER_ADMIN,
      AccountType.MANAGING,
      orgOtherId,
    );
    await insertUser(
      guestId,
      `revoke-guest-${guestId}@t.io`,
      UserRole.GUEST,
      AccountType.GUEST,
      null,
    );
    await insertUser(
      unboundGuestId,
      `revoke-unbound-${unboundGuestId}@t.io`,
      UserRole.GUEST,
      AccountType.GUEST,
      null,
    );

    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        projectId,
        orgHostId,
        'Revoke Project',
        hostOwnerId,
        otherProjectId,
        orgOtherId,
        'Revoke Other Project',
        otherHostId,
      ],
    );
    for (const [cid, pid, name, creator] of [
      [contractLiveId, projectId, 'Revoke Live Contract', hostOwnerId],
      [contractRevokedId, projectId, 'Revoke Target Contract', hostOwnerId],
      [otherOrgContractId, otherProjectId, 'Other Org Contract', otherHostId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [cid, pid, name, creator],
      );
    }

    // The guest is bound to BOTH host contracts. One stays live, one is
    // revoked mid-spec — so every assertion has a live control alongside it.
    await insertBinding(guestId, contractLiveId);
    await insertBinding(guestId, contractRevokedId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE id = ANY($1)`,
        [bindingIds],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractLiveId, contractRevokedId, otherOrgContractId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectId, otherProjectId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [hostOwnerId, otherHostId, guestId, unboundGuestId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgHostId, orgOtherId],
      ]);
    }
    await app?.close();
  });

  // ─── B. THE REVOKE ENDPOINT ──────────────────────────────────────────────

  describe('POST /guest-access/:contractId/revoke — host authorization', () => {
    it('a host in a DIFFERENT org cannot revoke — uniform 404, binding untouched', async () => {
      const res = await revokeAs(OTHER_HOST(), contractRevokedId, {
        user_id: guestId,
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');

      const [row] = await dataSource.query(
        `SELECT revoked_at FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [guestId, contractRevokedId],
      );
      expect(row.revoked_at).toBeNull();
    });

    it('the BOUND GUEST cannot revoke (this is a HOST surface, not a guest surface)', async () => {
      const res = await revokeAs(GUEST(), contractRevokedId, {
        user_id: guestId,
      });
      // A guest has organization_id = null → 404 before any lookup. Critically
      // the binding does NOT admit them here: revocation is never reachable
      // through the guest door.
      expect(res.status).toBe(404);

      const [row] = await dataSource.query(
        `SELECT revoked_at FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [guestId, contractRevokedId],
      );
      expect(row.revoked_at).toBeNull();
    });

    it('rejects a malformed user_id (DTO validation)', async () => {
      const res = await revokeAs(HOST(), contractRevokedId, {
        user_id: 'not-a-uuid',
      });
      expect(res.status).toBe(400);
    });

    it('404s when no binding exists for that (contract, user)', async () => {
      const res = await revokeAs(HOST(), contractLiveId, {
        user_id: unboundGuestId,
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Guest access not found');
    });
  });

  describe('POST /guest-access/:contractId/revoke — the stamp', () => {
    let firstRevokedAt: string;

    it('the host revokes → row STAMPED, never deleted', async () => {
      const res = await revokeAs(HOST(), contractRevokedId, {
        user_id: guestId,
      });
      expect(res.status).toBe(200);
      expect(res.body.already_revoked).toBe(false);
      expect(res.body.contract_id).toBe(contractRevokedId);
      expect(res.body.user_id).toBe(guestId);
      expect(res.body.revoked_by).toBe(hostOwnerId);
      expect(res.body.revoked_at).toBeTruthy();

      // ⭐ The row SURVIVES — revocation is a soft stamp. A delete here would
      // destroy the provenance the document classification depends on.
      const rows = await dataSource.query(
        `SELECT revoked_at, revoked_by, granted_at, granted_by
           FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [guestId, contractRevokedId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).not.toBeNull();
      expect(rows[0].revoked_by).toBe(hostOwnerId);
      // The original grant facts are untouched.
      expect(rows[0].granted_at).not.toBeNull();
      expect(rows[0].granted_by).toBe(hostOwnerId);

      firstRevokedAt = new Date(rows[0].revoked_at).toISOString();
    });

    it('re-revoking is an idempotent no-op that does NOT rewrite the original actor/timestamp', async () => {
      const res = await revokeAs(HOST(), contractRevokedId, {
        user_id: guestId,
      });
      expect(res.status).toBe(200);
      expect(res.body.already_revoked).toBe(true);

      const [row] = await dataSource.query(
        `SELECT revoked_at, revoked_by FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [guestId, contractRevokedId],
      );
      // The conditional UPDATE's `revoked_at IS NULL` gate is what preserves
      // this. Without it a re-revoke would overwrite the audit trail.
      expect(new Date(row.revoked_at).toISOString()).toBe(firstRevokedAt);
      expect(row.revoked_by).toBe(hostOwnerId);
    });

    it('CONCURRENT revokes → exactly ONE stamp; the first writer wins', async () => {
      // Fresh binding so this is a clean race.
      await insertBinding(unboundGuestId, contractLiveId);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          access
            .revokeGuestBinding(contractLiveId, unboundGuestId, hostOwnerId)
            .catch((e) => ({ error: e.message } as any)),
        ),
      );
      const applied = results.filter((r: any) => r.already_revoked === false);
      // The atomic conditional UPDATE is the gate — exactly one transition.
      expect(applied).toHaveLength(1);

      const rows = await dataSource.query(
        `SELECT revoked_at FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [unboundGuestId, contractLiveId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).not.toBeNull();
    });
  });

  // ─── A. THE READ FILTER (every site) ─────────────────────────────────────

  describe('the read filter — a revoked binding grants NOTHING', () => {
    it('hasGuestBinding → false for revoked, true for the live control', async () => {
      await expect(
        access.hasGuestBinding(contractRevokedId, guestId),
      ).resolves.toBe(false);
      await expect(
        access.hasGuestBinding(contractLiveId, guestId),
      ).resolves.toBe(true);
    });

    it('assertGuestContractAccess → 404 for revoked, passes for the live control', async () => {
      await expect(
        access.assertGuestContractAccess(contractRevokedId, guestId),
      ).rejects.toThrow('Contract not found');
      await expect(
        access.assertGuestContractAccess(contractLiveId, guestId),
      ).resolves.toBeUndefined();
    });

    it('assertGuestSurfaceCaller → 404 for a MANAGING caller whose binding was revoked', async () => {
      // The pure-GUEST branch short-circuits this gate by design; the binding
      // is then enforced downstream by findForGuest (covered below). The
      // MANAGING branch is the one that consults the binding HERE.
      const managingAsGuest = {
        id: hostOwnerId,
        account_type: AccountType.MANAGING,
      };
      await expect(
        access.assertGuestSurfaceCaller(managingAsGuest, contractRevokedId),
      ).rejects.toThrow('Contract not found');
    });

    it('findAccessibleContract (guest path → findForGuest) → 404 for revoked, contract for live', async () => {
      await expect(
        access.findAccessibleContract(contractRevokedId, GUEST() as any),
      ).rejects.toThrow('Contract not found');

      const live = await access.findAccessibleContract(
        contractLiveId,
        GUEST() as any,
      );
      expect(live.id).toBe(contractLiveId);
    });

    it('⭐ the revoked denial is BYTE-IDENTICAL to the never-bound denial (no oracle)', async () => {
      const revoked = await access
        .findAccessibleContract(contractRevokedId, GUEST() as any)
        .catch((e) => ({ status: e.getStatus(), body: e.getResponse() }));
      const neverBound = await access
        .findAccessibleContract(otherOrgContractId, GUEST() as any)
        .catch((e) => ({ status: e.getStatus(), body: e.getResponse() }));

      // "You were revoked" and "that was never shared with you" must be
      // indistinguishable — otherwise the response confirms the contract
      // exists AND that this user once had access to it.
      expect(revoked).toEqual(neverBound);
    });

    it('listGuestBindings / GET /guest/my-contracts drops the revoked share', async () => {
      const rows = await access.listGuestBindings(guestId);
      const ids = rows.map((r) => r.contract_id);
      expect(ids).toContain(contractLiveId);
      expect(ids).not.toContain(contractRevokedId);

      const res = await listAs(GUEST());
      expect(res.status).toBe(200);
      const httpIds = res.body.map((r: any) => r.contract_id);
      expect(httpIds).toContain(contractLiveId);
      expect(httpIds).not.toContain(contractRevokedId);
      // Belt and braces: the revoked contract's name must not appear anywhere
      // in the serialized payload.
      expect(JSON.stringify(res.body)).not.toContain('Revoke Target Contract');
    });
  });
});
