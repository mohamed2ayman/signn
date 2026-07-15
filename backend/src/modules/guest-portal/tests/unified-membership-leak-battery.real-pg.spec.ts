import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  Contract,
  GuestContractAccess,
  GuestInvitation,
  User,
  UserRole,
} from '../../../database/entities';
import { AuthService } from '../../auth/auth.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';
import { MeteringModule } from '../../metering/metering.module';
import { MeteringResolver } from '../../metering/services/metering-resolver.service';
import { MeteringService } from '../../metering/services/metering.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';
import { GuestCommentsController } from '../controllers/guest-comments.controller';
import { PublicGuestInvitationController } from '../controllers/public-guest-invitation.controller';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';

/**
 * ⭐ UNIFIED MEMBERSHIP — THE CROSS-ORG LEAK BATTERY (real Postgres).
 *
 * Ayman's acceptance criteria for the dispatch change (a real MANAGING
 * account may hold guest_contract_access bindings and use the guest surface
 * via its NORMAL JWT — Model A). Every assertion here is a tenant-isolation
 * invariant:
 *
 *   1. BOUND-ONLY REACH — org-A manager bound to org-B contract X reaches X
 *      (guest-scoped view) and NOTHING else in org B; own org-A access is
 *      byte-identical to findInOrg.
 *   2. NO-BINDING WALL — persona grants nothing; a binding-less manager is
 *      404-walled off every org-B contract.
 *   3. UNIFORM 404 — every denial is NotFoundException('Contract not found'),
 *      never 403/409; no existence oracle across no-binding / wrong-org /
 *      null-org / deleted-contract.
 *   4. GUEST-SCOPED VIEW — the binding determines the view: scrubbed users,
 *      proposed clauses excluded, internal notes filtered.
 *   5. METERING — the metered subject for a managing-as-guest action on X is
 *      org B (the HOST), never org A; the ForbiddenException tripwire is not
 *      reached on the binding path (and still fires for the managing shape —
 *      the invariant is intact, not weakened).
 *   6. MODEL A — the guest HTTP surface accepts the manager's NORMAL JWT
 *      principal when a binding exists (no guest JWT minted anywhere) and
 *      404s the same principal on a non-bound contract.
 *   7. PURE GUEST UNCHANGED — the org-less guest path behaves exactly as
 *      before.
 *
 * (Establish-identity items — real-account verify, anti-impersonation,
 *  MFA/no-bypass — are proven in the sibling
 *  guest-establish-identity-existing-account.real-pg.spec.ts.)
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[unified-membership] SKIPPING the cross-org leak battery ' +
      '(unified-membership-leak-battery.real-pg.spec.ts): DATABASE_URL unset — ' +
      'the tenant-isolation invariants MUST be proven against real Postgres. ' +
      'CI green here does NOT prove them.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// Full Nest module + real-PG fixtures + the metering engine take well over
// jest's 5s default (same posture as the sibling real-pg specs).
jest.setTimeout(120_000);

const INTERNAL_SENTINEL = `INTERNAL-NOTE-${randomUUID().slice(0, 8)}`;
const VISIBLE_SENTINEL = `VISIBLE-TEAM-${randomUUID().slice(0, 8)}`;
const GUEST_SENTINEL = `GUEST-COMMENT-${randomUUID().slice(0, 8)}`;

describeReal('⭐ Unified membership — cross-org leak battery (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let contractAccess: ContractAccessService;
  let meteringResolver: MeteringResolver;
  let metering: MeteringService;

  // ─── Fixture ids (deterministic for FK-safe cleanup) ────────────────────
  const orgAId = randomUUID(); // the manager's OWN org
  const orgBId = randomUUID(); // the HOST org (inviter)
  const userAId = randomUUID(); // MANAGING manager of org A — bound to X
  const ownerBId = randomUUID(); // MANAGING owner of org B (host team)
  const guestGId = randomUUID(); // pure org-less GUEST — bound to X
  const projectAId = randomUUID();
  const projectBId = randomUUID();
  const contractAId = randomUUID(); // org A — userA's own contract
  const contractXId = randomUUID(); // org B — userA IS bound
  const contractYId = randomUUID(); // org B — userA NOT bound
  const contractDelId = randomUUID(); // org B — bound, then hard-deleted
  const liveClauseId = randomUUID();
  const liveCcId = randomUUID();
  const proposedClauseId = randomUUID();
  const proposedCcId = randomUUID();
  const clauseAId = randomUUID();
  const ccAId = randomUUID();

  // ── Condition 2 (real-HTTP anti-impersonation + lockout) fixtures ──────
  // An EXISTING account (real bcrypt hash of a known password) + a valid
  // PENDING invitation for an org-B contract it is NOT bound to. Driven only
  // with WRONG passwords over the real establish-identity HTTP route.
  const lockUserId = randomUUID();
  const lockContractId = randomUUID(); // org B — the invite target
  const lockInvitationId = randomUUID();
  const LOCK_EMAIL = `lock-target-${lockUserId.slice(0, 8)}@managing.test`;
  const LOCK_PASSWORD = 'Correct#Horse9Batt';
  const LOCK_WRONG = 'wrong#Guess1Nope';
  let lockHash = '';

  // The principal the stubbed JwtAuthGuard injects (Model A: this is the
  // shape the manager's NORMAL managing JWT produces — nothing guest-minted).
  let injectedUser: any;

  const MANAGER_A = () => ({
    id: userAId,
    email: `manager-a-${userAId.slice(0, 8)}@org-a.test`,
    role: UserRole.OWNER_ADMIN,
    organization_id: orgAId,
    account_type: AccountType.MANAGING,
  });
  const GUEST_G = () => ({
    id: guestGId,
    email: `guest-${guestGId.slice(0, 8)}@external.test`,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });
  /** The caller shape ContractsController/guest services build from req.user. */
  const callerOf = (p: any) => ({
    id: p.id,
    organization_id: p.organization_id ?? null,
    role: p.role,
    account_type: p.account_type,
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
       VALUES ($1, $2, '$2a$10$battery.hash.sentinel.not.a.real.password.hashx',
               'Battery', 'User', $3, $4, $5,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, email, role, accountType, org],
    );
  };

  const insertComment = async (
    id: string,
    authorId: string,
    content: string,
    isInternal: boolean,
  ) => {
    await dataSource.query(
      `INSERT INTO contract_comments
         (id, contract_id, contract_clause_id, user_id, content,
          is_resolved, is_internal_note, parent_comment_id)
       VALUES ($1, $2, NULL, $3, $4, FALSE, $5, NULL)`,
      [id, contractXId, authorId, content, isInternal],
    );
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        // MeteringModule registers a Bull queue — the root Bull connection
        // must exist or module init hangs (same as the extraction spec).
        BullModule.forRoot({
          redis: process.env.REDIS_URL || 'redis://redis:6379',
        }),
        TypeOrmModule.forFeature([
          Contract,
          GuestContractAccess,
          GuestInvitation,
          User,
        ]),
        MeteringModule,
      ],
      // PublicGuestInvitationController hosts the PUBLIC establish-identity
      // route — Condition 2 drives wrong-password through it over real HTTP.
      controllers: [GuestCommentsController, PublicGuestInvitationController],
      providers: [
        ContractAccessService,
        GuestInvitationService,
        InvitationTokenService,
        ViewerCredentialService,
        // Real lockout stack (real PG) so the establish-identity password-verify
        // branch runs the SAME AccountLockoutService the login path uses.
        AccountLockoutService,
        SecurityEventService,
        {
          provide: AuthService,
          useValue: { issueGuestSession: jest.fn() },
        },
        {
          provide: GuestInvitationScopedRepository,
          useValue: { scopedFindByIdOrThrow: jest.fn() },
        },
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
      // The establish-identity route carries @ThrottleOnly('guest_invite_exchange');
      // the account-level lockout under test is a SEPARATE control, so the IP
      // throttle is neutralised here (mirrors the guest-chat controller spec).
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get(DataSource);
    contractAccess = moduleRef.get(ContractAccessService);
    meteringResolver = moduleRef.get(MeteringResolver);
    metering = moduleRef.get(MeteringService);

    // ─── Fixture tree ────────────────────────────────────────────────────
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgAId,
      `battery-orgA-${orgAId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgBId,
      `battery-orgB-${orgBId.slice(0, 8)}`,
    ]);
    await insertUser(userAId, MANAGER_A().email, 'OWNER_ADMIN', 'MANAGING', orgAId);
    await insertUser(
      ownerBId,
      `owner-b-${ownerBId.slice(0, 8)}@org-b.test`,
      'OWNER_ADMIN',
      'MANAGING',
      orgBId,
    );
    await insertUser(guestGId, GUEST_G().email, 'GUEST', 'GUEST', null);

    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, 'battery-project-A', $3)`,
      [projectAId, orgAId, userAId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, 'battery-project-B', $3)`,
      [projectBId, orgBId, ownerBId],
    );
    for (const [cid, pid, name, creator] of [
      [contractAId, projectAId, 'Battery Own Contract A', userAId],
      [contractXId, projectBId, 'Battery Bound Contract X', ownerBId],
      [contractYId, projectBId, 'Battery Unbound Contract Y', ownerBId],
      [contractDelId, projectBId, 'Battery Deleted Contract', ownerBId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [cid, pid, name, creator],
      );
    }

    // Bindings: userA → X, guestG → X, userA → contractDel (then delete it).
    for (const [uid, cid] of [
      [userAId, contractXId],
      [guestGId, contractXId],
      [userAId, contractDelId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), uid, cid, ownerBId],
      );
    }
    // Hard-delete the bound contract — FK CASCADE removes its binding; the
    // read must 404 (deleted-contract denial), same as every other denial.
    await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractDelId]);

    // Clauses on X: one LIVE + one PROPOSED (must never surface in reads).
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
       VALUES ($1, $2, 'Live Clause', 'live clause content', 'AI_EXTRACTED', 'APPROVED', $3)`,
      [liveClauseId, orgBId, ownerBId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1, $2, $3, 0, FALSE)`,
      [liveCcId, contractXId, liveClauseId],
    );
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
       VALUES ($1, $2, 'Proposed Clause', 'PROPOSED-PILE-SENTINEL content', 'AI_EXTRACTED', 'APPROVED', $3)`,
      [proposedClauseId, orgBId, ownerBId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1, $2, $3, 0, TRUE)`,
      [proposedCcId, contractXId, proposedClauseId],
    );
    // One live clause on userA's OWN contract (byte-identical compare).
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
       VALUES ($1, $2, 'Own Clause', 'own clause content', 'AI_EXTRACTED', 'APPROVED', $3)`,
      [clauseAId, orgAId, userAId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1, $2, $3, 0, FALSE)`,
      [ccAId, contractAId, clauseAId],
    );

    // Comments on X: a visible host-team comment, an INTERNAL note (the leak
    // sentinel), and the pure guest's own comment.
    await insertComment(randomUUID(), ownerBId, VISIBLE_SENTINEL, false);
    await insertComment(randomUUID(), ownerBId, INTERNAL_SENTINEL, true);
    await insertComment(randomUUID(), guestGId, GUEST_SENTINEL, false);

    // ── Condition 2 fixtures — existing account (real hash) + org-B contract
    //    + PENDING invitation to that email. Only WRONG passwords are sent.
    lockHash = await bcrypt.hash(LOCK_PASSWORD, 6);
    await insertUser(lockUserId, LOCK_EMAIL, 'OWNER_ADMIN', 'MANAGING', orgBId);
    await dataSource.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      lockHash,
      lockUserId,
    ]);
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Battery Lockout Contract', 'FIDIC_RED_BOOK', $3)`,
      [lockContractId, projectBId, ownerBId],
    );
    await dataSource.query(
      `INSERT INTO guest_invitations
         (id, contract_id, invited_email, invited_language, status,
          expires_at, created_by)
       VALUES ($1, $2, $3, 'en', 'PENDING', NOW() + interval '1 day', $4)`,
      [lockInvitationId, lockContractId, LOCK_EMAIL, ownerBId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Audit rows the lockout wrote for the impersonation target (LOGIN_FAILED
      // ×N + ACCOUNT_LOCKED). users FK is ON DELETE SET NULL, so this is hygiene
      // rather than a FK requirement — clear them while user_id is still set.
      await dataSource.query(`DELETE FROM audit_logs WHERE user_id = $1`, [
        lockUserId,
      ]);
      await dataSource.query(`DELETE FROM guest_invitations WHERE id = $1`, [
        lockInvitationId,
      ]);
      await dataSource.query(
        `DELETE FROM metering_ledger WHERE contract_ref = ANY($1)`,
        [[contractXId, contractYId, contractAId]],
      );
      await dataSource.query(
        `DELETE FROM metering_balance WHERE subject_ref = ANY($1)`,
        [[orgAId, orgBId]],
      );
      await dataSource.query(
        `DELETE FROM contract_comments WHERE contract_id = $1`,
        [contractXId],
      );
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE contract_id = ANY($1)`,
        [[contractXId, contractYId, contractAId, lockContractId]],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id = ANY($1)`,
        [[contractXId, contractAId]],
      );
      await dataSource.query(`DELETE FROM clauses WHERE id = ANY($1)`, [
        [liveClauseId, proposedClauseId, clauseAId],
      ]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractAId, contractXId, contractYId, contractDelId, lockContractId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectAId, projectBId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [userAId, ownerBId, guestGId, lockUserId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgAId, orgBId],
      ]);
    }
    await app?.close();
  });

  // ═══ 1. BOUND-ONLY REACH ══════════════════════════════════════════════

  it('⭐ BOUND-ONLY — org-A manager bound to X: CAN reach X (guest-scoped view)', async () => {
    const contract = await contractAccess.findAccessibleContract(
      contractXId,
      callerOf(MANAGER_A()),
    );
    expect(contract.id).toBe(contractXId);
    // Guest-scoped view: proposed clauses EXCLUDED, users scrubbed.
    const ccs = contract.contract_clauses ?? [];
    expect(ccs).toHaveLength(1);
    expect((ccs[0] as any).is_proposed).toBe(false);
    expect((contract.creator as any)?.password_hash).toBeUndefined();
    expect((contract.creator as any)?.mfa_totp_secret).toBeUndefined();
  });

  it('⭐ BOUND-ONLY — the SAME manager CANNOT reach any other org-B contract (no binding → 404), and gets NO org-wide visibility into org B', async () => {
    await expect(
      contractAccess.findAccessibleContract(contractYId, callerOf(MANAGER_A())),
    ).rejects.toThrow(NotFoundException);
    // No org-wide findInOrg reach into org B either — the binding to X grants
    // exactly X, nothing project- or org-wide.
    await expect(
      contractAccess.findInOrg(contractYId, orgAId),
    ).rejects.toThrow(NotFoundException);
  });

  it('⭐ BOUND-ONLY — own org-A access is BYTE-IDENTICAL to the pre-unified findInOrg path', async () => {
    const viaDispatch = await contractAccess.findAccessibleContract(
      contractAId,
      callerOf(MANAGER_A()),
    );
    const viaFindInOrg = await contractAccess.findInOrg(contractAId, orgAId);
    expect(JSON.parse(JSON.stringify(viaDispatch))).toEqual(
      JSON.parse(JSON.stringify(viaFindInOrg)),
    );
  });

  // ═══ 2. NO-BINDING WALL ═══════════════════════════════════════════════

  it('⭐ NO-BINDING WALL — a MANAGING user with NO binding cannot reach ANY org-B contract (persona grants nothing)', async () => {
    const strangerCaller = {
      id: randomUUID(),
      organization_id: randomUUID(),
      role: UserRole.OWNER_ADMIN,
      account_type: AccountType.MANAGING,
    };
    for (const cid of [contractXId, contractYId]) {
      await expect(
        contractAccess.findAccessibleContract(cid, strangerCaller as any),
      ).rejects.toThrow(NotFoundException);
    }
  });

  // ═══ 3. UNIFORM 404 — no existence oracle ═════════════════════════════

  it('⭐ UNIFORM 404 — every denial is NotFoundException("Contract not found"): no-binding / wrong-org / null-org / deleted-contract', async () => {
    const denials: Array<() => Promise<unknown>> = [
      // managing, no binding, cross-org
      () =>
        contractAccess.findAccessibleContract(contractYId, callerOf(MANAGER_A())),
      // managing, null org, no binding
      () =>
        contractAccess.findAccessibleContract(contractYId, {
          id: randomUUID(),
          organization_id: null,
          role: UserRole.OWNER_ADMIN,
          account_type: AccountType.MANAGING,
        } as any),
      // bound-then-DELETED contract (binding cascaded away with the row)
      () =>
        contractAccess.findAccessibleContract(
          contractDelId,
          callerOf(MANAGER_A()),
        ),
      // pure guest on a non-bound contract (unchanged guest wall)
      () =>
        contractAccess.findAccessibleContract(contractYId, callerOf(GUEST_G())),
      // nonexistent contract id
      () =>
        contractAccess.findAccessibleContract(randomUUID(), callerOf(MANAGER_A())),
    ];
    for (const run of denials) {
      let thrown: unknown;
      try {
        await run();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getStatus()).toBe(404);
      expect((thrown as NotFoundException).message).toBe('Contract not found');
    }
  });

  // ═══ 4 + 6. GUEST-SCOPED VIEW over HTTP with the NORMAL managing JWT ═══

  it('⭐ MODEL A — the manager\'s NORMAL JWT principal reads X\'s guest-visible comments over the guest surface; internal notes ABSENT', async () => {
    injectedUser = MANAGER_A();
    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractXId}/comments`)
      .set('Authorization', 'Bearer managing-jwt')
      .expect(200);

    const payload = JSON.stringify(res.body);
    expect(payload).toContain(VISIBLE_SENTINEL);
    expect(payload).toContain(GUEST_SENTINEL);
    // The leak sentinel: the host's INTERNAL note must be ABSENT.
    expect(payload).not.toContain(INTERNAL_SENTINEL);
    // Labeling: host-org author = TEAM; the pure guest = GUEST.
    const visible = res.body.find((c: any) => c.content === VISIBLE_SENTINEL);
    expect(visible.author_role).toBe('TEAM');
    const guestC = res.body.find((c: any) => c.content === GUEST_SENTINEL);
    expect(guestC.author_role).toBe('GUEST');
  });

  it('⭐ MODEL A — the managing-as-guest can POST a comment on X, and it labels GUEST (external), never TEAM', async () => {
    injectedUser = MANAGER_A();
    const posted = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractXId}/comments`)
      .set('Authorization', 'Bearer managing-jwt')
      .send({ content: 'external reviewer comment via managing JWT' })
      .expect(201);
    expect(posted.body.id).toBeDefined();
    // The response is scrubbed (no user_id / is_internal_note leak).
    expect(posted.body.user_id).toBeUndefined();
    expect(posted.body.is_internal_note).toBeUndefined();

    const list = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractXId}/comments`)
      .set('Authorization', 'Bearer managing-jwt')
      .expect(200);
    const mine = list.body.find(
      (c: any) => c.content === 'external reviewer comment via managing JWT',
    );
    expect(mine).toBeDefined();
    // A MANAGING author from org A is EXTERNAL on org B's contract → GUEST.
    expect(mine.author_role).toBe('GUEST');
  });

  it('⭐ MODEL A — the SAME managing JWT on a NON-bound org-B contract → uniform 404 over HTTP', async () => {
    injectedUser = MANAGER_A();
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractYId}/comments`)
      .set('Authorization', 'Bearer managing-jwt')
      .expect(404);
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractYId}/comments`)
      .set('Authorization', 'Bearer managing-jwt')
      .send({ content: 'must never land' })
      .expect(404);
  });

  // ═══ 5. METERING — subject = HOST org; tripwire not reached ═══════════

  it('⭐ METERING — subject for a binding-path action on X derives to org B (host), NOT org A; no ForbiddenException on the guest-door caller shape', async () => {
    // The guest door constructs the metering caller with account_type 'GUEST'
    // (door-derived — guest-chat.service.ts / guest-upload.service.ts). For a
    // managing-as-guest the jwt org is their REAL org A; the subject must
    // still be org B and the cross-check must NOT fire.
    const subject = await meteringResolver.resolveMeteringSubject(
      {
        user_id: userAId,
        jwt_organization_id: orgAId,
        account_type: 'GUEST',
      } as any,
      contractXId,
    );
    expect(subject).toBe(orgBId);
    expect(subject).not.toBe(orgAId);
  });

  it('⭐ METERING — a REAL reserve through the engine attributes the ledger row to org B (host pays), then releases cleanly', async () => {
    const reservation = await metering.reserve({
      caller: {
        user_id: userAId,
        jwt_organization_id: orgAId,
        account_type: 'GUEST',
      },
      meterKey: MeterKey.GUEST_UPLOAD,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: contractXId,
      actorRef: userAId,
      metadata: { route: 'leak-battery' },
    } as any);

    const rows = await dataSource.query(
      `SELECT subject_ref, actor_ref, contract_ref, meter_key
         FROM metering_ledger WHERE reservation_id = $1`,
      [reservation.reservation_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_ref).toBe(orgBId); // HOST org pays
    expect(rows[0].subject_ref).not.toBe(orgAId); // NEVER the caller's org
    expect(rows[0].actor_ref).toBe(userAId); // attribution = the person

    await metering.release(reservation.reservation_id);
  });

  it('⭐ METERING — the MANAGING-shape tripwire is INTACT (unchanged): managing caller + mismatched org still throws ForbiddenException', async () => {
    await expect(
      meteringResolver.resolveMeteringSubject(
        {
          user_id: userAId,
          jwt_organization_id: orgAId,
          account_type: 'MANAGING',
        } as any,
        contractXId,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ═══ 7. PURE GUEST UNCHANGED ══════════════════════════════════════════

  it('⭐ PURE GUEST — the org-less guest path is unchanged: bound guest reads X (200, internal note absent); unbound contract 404; viewer-shaped 404; no credential 401', async () => {
    injectedUser = GUEST_G();
    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractXId}/comments`)
      .set('Authorization', 'Bearer guest-jwt')
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL_SENTINEL);

    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractYId}/comments`)
      .set('Authorization', 'Bearer guest-jwt')
      .expect(404);

    injectedUser = {
      type: 'viewer',
      viewer: { contract_id: contractXId, invitation_id: randomUUID() },
    };
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractXId}/comments`)
      .set('Authorization', 'Bearer viewer-shaped')
      .expect(404);

    injectedUser = null;
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractXId}/comments`)
      .expect(401);
  });

  // ═══ 8. CONDITION 2 — REAL-HTTP ANTI-IMPERSONATION + ACCOUNT LOCKOUT ═══
  // Drives WRONG passwords through the REAL establish-identity HTTP route
  // (controller → guard → throttle), proving: 401 (never a binding / clobber),
  // and the SAME account-level lockout the login path uses trips after the
  // shared threshold. NOT service.establishIdentity() directly — the boundary
  // is the point (the pattern that hid the boot bug + knowledge_context drop).
  it('⭐ ANTI-IMPERSONATION (real HTTP) — wrong password → 401, account untouched, no binding; the login-parity lockout trips after the threshold', async () => {
    const tokenService = moduleRef.get(InvitationTokenService);
    const token = tokenService.issue(
      lockInvitationId,
      new Date(Date.now() + 24 * 3600 * 1000),
    );
    const post = (password: string) =>
      request(app.getHttpServer())
        .post('/public/guest-invitations/establish-identity')
        .send({ token, password });

    const lockUserRow = async () =>
      (
        await dataSource.query(
          `SELECT password_hash, account_type, organization_id, role,
                  failed_login_attempts, locked_until
             FROM users WHERE id = $1`,
          [lockUserId],
        )
      )[0];
    const lockBindings = async () =>
      dataSource.query(
        `SELECT id FROM guest_contract_access WHERE contract_id = $1`,
        [lockContractId],
      );

    // ── Attempt 1 (wrong) → 401; failed attempt DURABLY recorded (survives the
    //    transaction rollback); NO binding; identity byte-untouched. ──────────
    await post(LOCK_WRONG).expect(401);
    let row = await lockUserRow();
    expect(Number(row.failed_login_attempts)).toBe(1);
    expect(row.locked_until).toBeNull();
    expect(await lockBindings()).toHaveLength(0);
    expect(row.password_hash).toBe(lockHash);
    expect(row.account_type).toBe(AccountType.MANAGING);
    expect(row.organization_id).toBe(orgBId);
    expect(row.role).toBe('OWNER_ADMIN');

    // ── Attempts 2–4 (wrong) → 401 each; counter climbs, still not locked. ───
    for (let n = 2; n <= 4; n++) {
      await post(LOCK_WRONG).expect(401);
      row = await lockUserRow();
      expect(Number(row.failed_login_attempts)).toBe(n);
      expect(row.locked_until).toBeNull();
    }

    // ── Attempt 5 (wrong) → 401; threshold reached → account LOCKED. ─────────
    await post(LOCK_WRONG).expect(401);
    row = await lockUserRow();
    expect(Number(row.failed_login_attempts)).toBe(5);
    expect(row.locked_until).not.toBeNull();
    expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now());

    // ── Attempt 6 → 403 LOCKED (refused BEFORE the password check), even with
    //    the CORRECT password: a locked account is locked for establish-identity
    //    exactly as it is for login. Counter does NOT climb past the threshold.
    await post(LOCK_PASSWORD).expect(403);
    row = await lockUserRow();
    expect(Number(row.failed_login_attempts)).toBe(5);

    // ── Invariant across the whole sequence: identity never clobbered, and the
    //    invitation never minted a binding onto the impersonation target. ─────
    expect(await lockBindings()).toHaveLength(0);
    expect(row.password_hash).toBe(lockHash);
    expect(row.account_type).toBe(AccountType.MANAGING);
    expect(row.organization_id).toBe(orgBId);
  });
});
