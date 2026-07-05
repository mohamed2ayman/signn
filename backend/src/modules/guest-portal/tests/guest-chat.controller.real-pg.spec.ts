import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
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
import { ChatSession } from '../../../database/entities/chat-session.entity';
import { ChatMessage } from '../../../database/entities/chat-message.entity';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { AiService } from '../../ai/ai.service';
import { MeteringService } from '../../metering/services/metering.service';
import { MeteringResolver } from '../../metering/services/metering-resolver.service';
import { MeterDefinition } from '../../metering/entities/meter-definition.entity';
import { PlanAllowance } from '../../metering/entities/plan-allowance.entity';
import { SubjectAllowance } from '../../metering/entities/subject-allowance.entity';
import { MeteringLedger } from '../../metering/entities/metering-ledger.entity';
import { MeteringBalance } from '../../metering/entities/metering-balance.entity';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { THROTTLER_NAMES } from '../../../common/decorators/throttle-only.decorator';
import { GuestChatController } from '../controllers/guest-chat.controller';
import { GuestChatService } from '../services/guest-chat.service';
// Slice 3 — GuestChatService now injects the SINGLE filtered comment path.
// The service is REAL (its readGuestVisibleComments query is part of what
// this spec proves); its deps unused on the read path are stubbed.
import { GuestInvitationService } from '../services/guest-invitation.service';
import { GuestInvitation } from '../../../database/entities/guest-invitation.entity';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';
import { AuthService } from '../../auth/auth.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';

/**
 * Guest chat Slice 1 — REAL-Postgres proof.
 *
 * Runs against the live Postgres so the binding wall (guest_contract_access →
 * findForGuest), the STRICT context projection, the race-safe 20/day cap
 * (atomic conditional UPSERT), and the REAL metering engine
 * (reserve→commit/release on guest_ai_query) are exercised for real. CI is
 * unit-test ONLY (CLAUDE.md), so this skips LOUDLY when DATABASE_URL is unset.
 *
 * What is real: DataSource, ContractAccessService, GuestChatService,
 * MeteringService + MeteringResolver (real ledger/balance rows; requires the
 * 1763000000001 meter seed migration to have run). What is stubbed: the JWT
 * guard (principal injected), the Throttler guard (burst protection is
 * orthogonal to the daily cap), SubscriptionsService (null → default_limit),
 * and the ai-backend HTTP boundary (AiService mocked — the dispatched payload
 * is CAPTURED there, which is exactly where the context-purity proof lives).
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-chat] SKIPPING real-Postgres spec (guest-chat.controller.real-pg.spec.ts): ' +
      'DATABASE_URL unset — this MUST run against Postgres to prove the binding wall ' +
      '(404 on cross-contract), CONTEXT PURITY (no proposed/comment/risk leak into the ' +
      'AI payload), and the RACE-SAFE 20/day cap (21 concurrent → exactly 20 succeed). ' +
      'CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// ─── Leak sentinels: each one is seeded into a table the guest chat context
//     must NEVER read. If any of these strings reaches the AI payload, the
//     strict boundary is broken. ─────────────────────────────────────────────
const ACTIVE_SENTINEL_1 = 'ACTIVE-CLAUSE-SENTINEL-ONE retention rate is five percent';
const ACTIVE_SENTINEL_2 = 'ACTIVE-CLAUSE-SENTINEL-TWO liquidated damages cap';
const INACTIVE_SENTINEL = 'INACTIVE-CLAUSE-SENTINEL superseded old wording';
const PROPOSED_SENTINEL = 'PROPOSED-CLAUSE-SENTINEL guest draft wording';
const VISIBLE_COMMENT_SENTINEL = 'VISIBLE-COMMENT-SENTINEL guest asked about payment';
const INTERNAL_NOTE_SENTINEL = 'INTERNAL-NOTE-SENTINEL do not show the counterparty';
const RISK_SENTINEL = 'RISK-SENTINEL unlimited liability exposure finding';
const OBLIGATION_SENTINEL = 'OBLIGATION-SENTINEL submit performance bond by June';
const OTHER_CONTRACT_SENTINEL = 'OTHER-CONTRACT-SENTINEL clause from contract B';

describeReal('GuestChatController / GuestChatService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let service: GuestChatService;

  const CAP = GuestChatService.GUEST_DAILY_AI_QUERY_CAP; // 20

  // Fixture refs.
  const orgId = randomUUID();
  const guestAId = randomUUID();
  const guestBId = randomUUID(); // second guest, bound to the SAME contract
  const ownerUserId = randomUUID();
  const projectId = randomUUID();
  const contractBoundId = randomUUID(); // guest A + B bound
  const contractBound2Id = randomUUID(); // guest A ALSO bound (session-reuse proof)
  const contractUnboundId = randomUUID(); // nobody bound
  const GUEST_A_EMAIL = `guest-chat-a-${guestAId.slice(0, 8)}@external.test`;
  const GUEST_B_EMAIL = `guest-chat-b-${guestBId.slice(0, 8)}@external.test`;
  const OWNER_EMAIL = `owner-chat-${ownerUserId.slice(0, 8)}@managing.test`;

  // The principal the (stubbed) JwtAuthGuard injects. Mutated per-test.
  let injectedUser: any;

  // ai-backend HTTP boundary mock — the purity-proof capture point.
  const triggerChatMock = jest.fn(async (_data: any) => ({
    job_id: `chat-job-${randomUUID()}`,
    status: 'queued',
  }));
  const getJobStatusMock = jest.fn(
    async (_jobId: string): Promise<Record<string, any>> => ({
      status: 'pending',
    }),
  );

  const GUEST_A = () => ({
    id: guestAId,
    email: GUEST_A_EMAIL,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });
  const GUEST_B = () => ({
    id: guestBId,
    email: GUEST_B_EMAIL,
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
       VALUES ($1, $2, $3, 'Chat', 'Test', $4, $5, $6,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [
        id,
        email,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.guest.chat.test',
        role,
        accountType,
        org,
      ],
    );
  };

  const insertClause = async (
    contractId: string,
    section: string,
    orderIndex: number,
    title: string,
    content: string,
    opts?: { isActive?: boolean; isProposed?: boolean },
  ) => {
    const clauseId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, title, content, version, is_active, source, review_status)
       VALUES ($1, $2, $3, 1, $4, 'AI_EXTRACTED', 'APPROVED')`,
      [clauseId, title, content, opts?.isActive ?? true],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), contractId, clauseId, section, orderIndex, opts?.isProposed ?? false],
    );
    return clauseId;
  };

  const utcToday = () => new Date().toISOString().slice(0, 10);

  const readDailyCount = async (contractId: string): Promise<number> => {
    const rows = await dataSource.query(
      `SELECT count FROM guest_ai_query_daily_counts WHERE contract_id = $1 AND day = $2`,
      [contractId, utcToday()],
    );
    return rows.length ? Number(rows[0].count) : 0;
  };

  const seedDailyCount = async (contractId: string, n: number): Promise<void> => {
    await dataSource.query(
      `INSERT INTO guest_ai_query_daily_counts (contract_id, day, count)
            VALUES ($1, $2, $3)
       ON CONFLICT (contract_id, day) DO UPDATE SET count = $3`,
      [contractId, utcToday(), n],
    );
  };

  const ledgerRow = async (reservationId: string) => {
    const rows = await dataSource.query(
      `SELECT status::text AS status, meter_key::text AS meter_key,
              subject_ref, contract_ref
         FROM metering_ledger WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows[0] ?? null;
  };

  const cleanupChatAndMetering = async () => {
    await dataSource.query(
      `DELETE FROM chat_messages WHERE contract_id = ANY($1)`,
      [[contractBoundId, contractBound2Id, contractUnboundId]],
    );
    await dataSource.query(
      `DELETE FROM chat_sessions WHERE contract_id = ANY($1)`,
      [[contractBoundId, contractBound2Id, contractUnboundId]],
    );
    await dataSource.query(
      `DELETE FROM metering_ledger WHERE meter_key = 'guest_ai_query' AND subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM metering_balance WHERE meter_key = 'guest_ai_query' AND subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM guest_ai_query_daily_counts WHERE contract_id = ANY($1)`,
      [[contractBoundId, contractBound2Id, contractUnboundId]],
    );
  };

  /** POST helper: create a session for the injected principal. */
  const createSessionHttp = (contractId: string) =>
    request(app.getHttpServer())
      .post(`/guest/contracts/${contractId}/chat/sessions`)
      .set('Authorization', 'Bearer valid-token');

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    const guardStub = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers.authorization?.includes('valid-token')) {
          throw new UnauthorizedException();
        }
        req.user = injectedUser;
        return true;
      },
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([
          Contract,
          GuestContractAccess,
          User,
          ChatSession,
          ChatMessage,
          GuestInvitation,
          MeterDefinition,
          PlanAllowance,
          SubjectAllowance,
          MeteringLedger,
          MeteringBalance,
        ]),
      ],
      controllers: [GuestChatController],
      providers: [
        GuestChatService,
        ContractAccessService,
        MeteringService,
        MeteringResolver,
        // Slice 3 — REAL GuestInvitationService: readGuestVisibleComments (the
        // single filtered comment path) runs its real QueryBuilder against the
        // real DB. Deps unused by that read path are inert stubs.
        GuestInvitationService,
        { provide: InvitationTokenService, useValue: {} },
        { provide: ViewerCredentialService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: GuestInvitationScopedRepository, useValue: {} },
        // No org subscription → the resolver falls through to the
        // meter_definitions.default_limit (1,000,000 placeholder) — the daily
        // counter, not the meter, is the binding cap. Exactly production
        // shape for a fresh org.
        {
          provide: SubscriptionsService,
          useValue: { getOrgSubscription: async () => null },
        },
        {
          provide: AiService,
          useValue: {
            triggerChat: triggerChatMock,
            getJobStatus: getJobStatusMock,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardStub)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(GuestChatService);
    app = moduleRef.createNestApplication();
    await app.init();

    // ─── Seed the fixture tree. ─────────────────────────────────────────
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `guest-chat-org-${orgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerUserId, OWNER_EMAIL, 'OWNER_ADMIN', 'MANAGING', orgId);
    await insertUser(guestAId, GUEST_A_EMAIL, 'GUEST', 'GUEST', null);
    await insertUser(guestBId, GUEST_B_EMAIL, 'GUEST', 'GUEST', null);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, 'guest-chat-project', $3)`,
      [projectId, orgId, ownerUserId],
    );
    for (const [cid, cname] of [
      [contractBoundId, 'Bound Contract A'],
      [contractBound2Id, 'Bound Contract A2'],
      [contractUnboundId, 'Unbound Contract B'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [cid, projectId, cname, ownerUserId],
      );
    }
    // Bindings: guest A → contract A + A2; guest B → contract A only.
    for (const [uid, cid] of [
      [guestAId, contractBoundId],
      [guestAId, contractBound2Id],
      [guestBId, contractBoundId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), uid, cid, ownerUserId],
      );
    }

    // ─── Contract A content: what MAY flow + every leak sentinel. ────────
    await insertClause(contractBoundId, '1', 0, 'Retention', ACTIVE_SENTINEL_1);
    await insertClause(contractBoundId, '2', 1, 'Damages', ACTIVE_SENTINEL_2);
    await insertClause(contractBoundId, '3', 2, 'Old wording', INACTIVE_SENTINEL, {
      isActive: false,
    });
    await insertClause(contractBoundId, 'P1', 3, 'Guest proposal', PROPOSED_SENTINEL, {
      isProposed: true,
    });
    await insertClause(
      contractUnboundId,
      '1',
      0,
      'Other contract clause',
      OTHER_CONTRACT_SENTINEL,
    );
    // Comments: the VISIBLE one now flows into context (Slice 3); the
    // INTERNAL note must NEVER leak. The exhaustive per-taxonomy battery
    // lives in guest-chat-comments-leak.real-pg.spec.ts.
    for (const [content, internal] of [
      [VISIBLE_COMMENT_SENTINEL, false],
      [INTERNAL_NOTE_SENTINEL, true],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contract_comments (id, contract_id, user_id, content, is_resolved, is_internal_note)
         VALUES ($1, $2, $3, $4, FALSE, $5)`,
        [randomUUID(), contractBoundId, ownerUserId, content, internal],
      );
    }
    // Risk + obligation rows — must NOT leak.
    await dataSource.query(
      `INSERT INTO risk_analyses (id, contract_id, risk_category, risk_level, description,
                                  status, likelihood, impact, risk_score,
                                  likelihood_source, impact_source)
       VALUES ($1, $2, 'liability', 'HIGH', $3, 'OPEN', 3, 5, 15, 'FALLBACK', 'FALLBACK')`,
      [randomUUID(), contractBoundId, RISK_SENTINEL],
    );
    await dataSource.query(
      `INSERT INTO obligations (id, contract_id, description, status,
                                reminder_days_before, is_critical, reminder_schedule)
       VALUES ($1, $2, $3, 'PENDING', 7, FALSE, '{30,14,7,1}')`,
      [randomUUID(), contractBoundId, OBLIGATION_SENTINEL],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupChatAndMetering();
      await dataSource.query(`DELETE FROM risk_analyses WHERE contract_id = $1`, [
        contractBoundId,
      ]);
      await dataSource.query(`DELETE FROM obligations WHERE contract_id = $1`, [
        contractBoundId,
      ]);
      await dataSource.query(`DELETE FROM contract_comments WHERE contract_id = $1`, [
        contractBoundId,
      ]);
      const clauseIds: Array<{ clause_id: string }> = await dataSource.query(
        `SELECT clause_id FROM contract_clauses WHERE contract_id = ANY($1)`,
        [[contractBoundId, contractBound2Id, contractUnboundId]],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id = ANY($1)`,
        [[contractBoundId, contractBound2Id, contractUnboundId]],
      );
      await dataSource.query(`DELETE FROM clauses WHERE id = ANY($1)`, [
        clauseIds.map((r) => r.clause_id),
      ]);
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE contract_id = ANY($1)`,
        [[contractBoundId, contractBound2Id, contractUnboundId]],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractBoundId, contractBound2Id, contractUnboundId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [guestAId, guestBId, ownerUserId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await app?.close();
  });

  beforeEach(async () => {
    injectedUser = GUEST_A();
    triggerChatMock.mockClear();
    getJobStatusMock.mockClear();
    getJobStatusMock.mockImplementation(async () => ({ status: 'pending' }));
    await cleanupChatAndMetering();
  });

  // ═══ PRE-FLIGHT ═══════════════════════════════════════════════════════

  it('meter seed migration ran: guest_ai_query definition row exists', async () => {
    const rows = await dataSource.query(
      `SELECT meter_key::text, window_type::text, fail_mode::text
         FROM meter_definitions WHERE meter_key = 'guest_ai_query'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].window_type).toBe('per_contract');
    expect(rows[0].fail_mode).toBe('closed');
  });

  it('burst throttler guest_ai_query is registered in THROTTLER_NAMES', () => {
    expect(THROTTLER_NAMES).toContain('guest_ai_query');
  });

  // ═══ ⭐ THE WALL ═══════════════════════════════════════════════════════

  it('⭐ WALL — all four routes are 404 for a contract the guest is not bound to', async () => {
    // A real session on the BOUND contract, to probe with real ids.
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    const sent = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'first question' })
      .expect(201);
    const mid = sent.body.assistant_message.id;
    triggerChatMock.mockClear();

    // 1 — create session on the unbound contract.
    await createSessionHttp(contractUnboundId).expect(404);
    // 2 — read the session through the unbound contract path.
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractUnboundId}/chat/sessions/${sid}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
    // 3 — send a message through the unbound contract path.
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractUnboundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'probe' })
      .expect(404);
    // 4 — poll a message through the unbound contract path.
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractUnboundId}/chat/messages/${mid}/status`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);

    // Nothing was dispatched and no daily slot was consumed on the probes.
    expect(triggerChatMock).not.toHaveBeenCalled();
    expect(await readDailyCount(contractUnboundId)).toBe(0);
  });

  it("⭐ WALL — a second guest's session on the SAME contract is 404 for guest one (and vice versa)", async () => {
    // Guest B creates a session on contract A.
    injectedUser = GUEST_B();
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sidB = created.body.id;
    const sentB = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sidB}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'guest B question' })
      .expect(201);
    const midB = sentB.body.assistant_message.id;

    // Guest A (bound to the same contract!) can see NOTHING of it.
    injectedUser = GUEST_A();
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/sessions/${sidB}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sidB}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'hijack attempt' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/messages/${midB}/status`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
  });

  it('⭐ WALL — a session created on contract A cannot receive messages via contract A2 (both bound to the SAME guest)', async () => {
    // Guest A is bound to BOTH contracts, so the binding wall passes for
    // either path — this isolates the session→contract binding itself.
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sidOnA = created.body.id;

    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBound2Id}/chat/sessions/${sidOnA}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'cross-contract session reuse' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBound2Id}/chat/sessions/${sidOnA}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
    expect(triggerChatMock).not.toHaveBeenCalled();
    expect(await readDailyCount(contractBound2Id)).toBe(0);
  });

  it('GATE — managing principal → 403; viewer-shaped principal → 403; no credential → 401', async () => {
    injectedUser = {
      id: ownerUserId,
      email: OWNER_EMAIL,
      role: UserRole.OWNER_ADMIN,
      organization_id: orgId,
      account_type: AccountType.MANAGING,
    };
    await createSessionHttp(contractBoundId).expect(403);

    injectedUser = {
      type: 'viewer',
      viewer: { contract_id: contractBoundId, invitation_id: randomUUID() },
    };
    await createSessionHttp(contractBoundId).expect(403);

    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions`)
      .expect(401);
    expect(triggerChatMock).not.toHaveBeenCalled();
  });

  // ═══ ⭐ CONTEXT PURITY (the leak test) ══════════════════════════════════

  it('⭐ PURITY — dispatched context contains metadata + ACTIVE clauses with §sections, and NONE of the excluded content', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'What is the retention rate?' })
      .expect(201);

    expect(triggerChatMock).toHaveBeenCalledTimes(1);
    const payload = triggerChatMock.mock.calls[0][0];

    // Routed correctly: host org subject, bound contract.
    expect(payload.org_id).toBe(orgId);
    expect(payload.contract_id).toBe(contractBoundId);
    expect(payload.message).toBe('What is the retention rate?');

    const ctx: string = payload.contract_context;
    expect(typeof ctx).toBe('string');

    // MUST contain: contract metadata + both ACTIVE clauses, §-labeled for
    // citation chips.
    expect(ctx).toContain('Bound Contract A');
    expect(ctx).toContain('[§1]');
    expect(ctx).toContain('[§2]');
    expect(ctx).toContain(ACTIVE_SENTINEL_1);
    expect(ctx).toContain(ACTIVE_SENTINEL_2);

    // MUST NOT contain — anywhere in the ENTIRE dispatched payload, not just
    // the context field. Serialize the whole thing and assert absence.
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(PROPOSED_SENTINEL); // proposed clauses (Slice 2 artifacts)
    expect(wire).not.toContain(INACTIVE_SENTINEL); // inactive clause versions
    expect(wire).toContain(VISIBLE_COMMENT_SENTINEL); // visible comments IN (Slice 3)
    expect(wire).not.toContain(INTERNAL_NOTE_SENTINEL); // internal notes EVER
    expect(wire).not.toContain(RISK_SENTINEL); // risk analyses EVER
    expect(wire).not.toContain(OBLIGATION_SENTINEL); // obligations EVER
    expect(wire).not.toContain(OTHER_CONTRACT_SENTINEL); // other contracts EVER
  });

  // ═══ ⭐ CAPS ═════════════════════════════════════════════════════════════

  it('⭐ CAPS — 21 concurrent sends → EXACTLY 20 succeed, 21st gets 429 with {remaining:0, cap:20, resets_at} (race-safe)', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    const guest = GUEST_A();

    // Direct service calls bypass the network burst throttle so this
    // isolates the daily-cap atomic counter.
    const attempts = Array.from({ length: CAP + 1 }, (_, i) =>
      service.sendMessage(contractBoundId, sid, guest as any, `q-${i}`),
    );
    const settled = await Promise.allSettled(attempts);

    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled',
    );
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(CAP);
    expect(rejected).toHaveLength(1);

    // The single rejection is the daily-cap quota error with the full
    // frontend contract.
    const reason = rejected[0].reason;
    expect(reason?.getStatus?.()).toBe(429);
    const body = reason?.getResponse?.();
    expect(body?.error).toBe('GUEST_AI_QUERY_DAILY_LIMIT');
    expect(body?.remaining).toBe(0);
    expect(body?.cap).toBe(CAP);
    expect(typeof body?.resets_at).toBe('string');
    // resets_at is the NEXT UTC midnight (a parseable future instant).
    expect(new Date(body.resets_at).getTime()).toBeGreaterThan(Date.now());

    // Counter serialized exactly CAP claims; every success carried the
    // real-data pill contract {remaining, cap} with a distinct remaining.
    expect(await readDailyCount(contractBoundId)).toBe(CAP);
    const remainings = fulfilled.map((f) => f.value.remaining).sort((a, b) => a - b);
    expect(remainings).toEqual(Array.from({ length: CAP }, (_, i) => i));
    for (const f of fulfilled) expect(f.value.cap).toBe(CAP);

    // The REAL metering engine reserved exactly CAP ledger rows, all against
    // the HOST org.
    const rows = await dataSource.query(
      `SELECT count(*)::int AS c FROM metering_ledger
        WHERE meter_key = 'guest_ai_query' AND subject_ref = $1
          AND contract_ref = $2 AND status = 'reserved'`,
      [orgId, contractBoundId],
    );
    expect(Number(rows[0].c)).toBe(CAP);
  });

  it('CAPS — at the seeded cap, an HTTP send is 429 with the reset payload and dispatches nothing', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    await seedDailyCount(contractBoundId, CAP);
    triggerChatMock.mockClear();

    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'one more?' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('GUEST_AI_QUERY_DAILY_LIMIT');
    expect(res.body.remaining).toBe(0);
    expect(res.body.cap).toBe(CAP);
    expect(typeof res.body.resets_at).toBe('string');
    expect(triggerChatMock).not.toHaveBeenCalled();
    expect(await readDailyCount(contractBoundId)).toBe(CAP);
  });

  it('⭐ CAPS — dispatch failure releases BOTH the reservation and the daily slot', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    triggerChatMock.mockRejectedValueOnce(new Error('ECONNREFUSED ai-backend'));

    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'doomed question' })
      .expect(201);

    // The assistant turn is terminal-FAILED, honestly reported.
    expect(res.body.assistant_message.status).toBe('FAILED');
    // Daily slot refunded — the failed question was NOT counted.
    expect(await readDailyCount(contractBoundId)).toBe(0);
    expect(res.body.remaining).toBe(CAP);
    // The reservation was released (engine refund of record).
    const rows = await dataSource.query(
      `SELECT status::text AS status FROM metering_ledger
        WHERE meter_key = 'guest_ai_query' AND subject_ref = $1`,
      [orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('released');
    // No reservation pinned on the FAILED row (it was released in-request).
    expect(res.body.assistant_message.error_message).toBeTruthy();
  });

  it('CAPS — meter lifecycle: reserve on send → commit on COMPLETED status poll', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    const sent = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'What is the retention rate?' })
      .expect(201);
    const mid = sent.body.assistant_message.id;

    // Reservation pinned on the assistant row, status reserved.
    const msgRows = await dataSource.query(
      `SELECT reservation_id FROM chat_messages WHERE id = $1`,
      [mid],
    );
    const reservationId = msgRows[0].reservation_id;
    expect(reservationId).toBeTruthy();
    expect((await ledgerRow(reservationId)).status).toBe('reserved');

    // AI completes → poll advances → COMMITTED.
    getJobStatusMock.mockResolvedValueOnce({
      status: 'completed',
      result: {
        result: {
          response: 'The retention rate is five percent (§1).',
          citations: [{ text: 'retention', source: '§1' }],
        },
      },
    });
    const polled = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/messages/${mid}/status`)
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(polled.body.status).toBe('COMPLETED');
    expect(polled.body.content).toContain('retention rate');
    expect((await ledgerRow(reservationId)).status).toBe('committed');

    // Idempotent on terminal: a second poll returns as-is, still committed.
    const again = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/messages/${mid}/status`)
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    expect(again.body.status).toBe('COMPLETED');
    expect((await ledgerRow(reservationId)).status).toBe('committed');
  });

  it('CAPS — AI job failure on status poll → FAILED + reservation released', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;
    const sent = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'will fail' })
      .expect(201);
    const mid = sent.body.assistant_message.id;
    const reservationId = (
      await dataSource.query(`SELECT reservation_id FROM chat_messages WHERE id = $1`, [mid])
    )[0].reservation_id;

    getJobStatusMock.mockResolvedValueOnce({ status: 'failed', error: 'boom' });
    const polled = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/messages/${mid}/status`)
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(polled.body.status).toBe('FAILED');
    expect(polled.body.error_message).toBe('boom');
    expect((await ledgerRow(reservationId)).status).toBe('released');
  });

  // ═══ MULTI-TURN + RESUME ════════════════════════════════════════════════

  it('MULTI-TURN — second send carries [user, assistant] history (without duplicating the current question); GET session resumes the full transcript', async () => {
    const created = await createSessionHttp(contractBoundId).expect(201);
    const sid = created.body.id;

    // Turn 1: send + complete.
    const sent1 = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'turn one question' })
      .expect(201);
    getJobStatusMock.mockResolvedValueOnce({
      status: 'completed',
      result: { result: { response: 'turn one answer', citations: [] } },
    });
    await request(app.getHttpServer())
      .get(
        `/guest/contracts/${contractBoundId}/chat/messages/${sent1.body.assistant_message.id}/status`,
      )
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    // Turn 2: history must be exactly the completed turn-1 pair.
    triggerChatMock.mockClear();
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'turn two question' })
      .expect(201);

    const payload = triggerChatMock.mock.calls[0][0];
    expect(payload.history).toEqual([
      { role: 'user', content: 'turn one question' },
      { role: 'assistant', content: 'turn one answer' },
    ]);
    expect(payload.message).toBe('turn two question');

    // Resume: full transcript in order, sanitized shape.
    const session = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/chat/sessions/${sid}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    const roles = session.body.messages.map((m: any) => m.role);
    expect(roles).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
    expect(session.body.messages[1].content).toBe('turn one answer');
    // Sanitized: no user_id / org_id / session internals in the projection.
    expect(session.body.messages[0].user_id).toBeUndefined();
    expect(session.body.messages[0].org_id).toBeUndefined();
  });
});
