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
import { GuestInvitation } from '../../../database/entities/guest-invitation.entity';
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
import { GuestChatController } from '../controllers/guest-chat.controller';
import { GuestChatService } from '../services/guest-chat.service';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';
import { AuthService } from '../../auth/auth.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';

/**
 * ⭐ Guest chat Slice 3 — THE INTERNAL-NOTE LEAK BATTERY (real Postgres).
 *
 * The entire risk of Slice 3 is a single leak class: a host INTERNAL-NOTE
 * comment (is_internal_note = true — the fail-closed default) reaching the
 * AI context and thereby an external counterparty. This spec seeds every
 * comment-taxonomy variant with a UNIQUE sentinel, asks the guest AI three
 * differently-shaped questions (the filter is at ASSEMBLY, so phrasing must
 * not matter — including a question that explicitly ASKS for the internal
 * notes), captures the FULL serialized payload at the mocked ai-backend
 * boundary, and asserts presence/absence per sentinel.
 *
 * Also proves FILTER-AT-SOURCE (the fetch itself returns zero internal rows
 * — belt) and AUTHOR-SCRUB (no host email / role / account_type anywhere in
 * the payload; no parent_comment_id UUIDs — suspenders).
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-chat-s3] SKIPPING real-Postgres leak battery ' +
      '(guest-chat-comments-leak.real-pg.spec.ts): DATABASE_URL unset. This spec ' +
      'is the security proof that internal notes NEVER reach the AI payload — ' +
      'CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// ─── The comment taxonomy — every variant, each with a unique sentinel. ─────
const S3_VISIBLE_TEAM =
  'S3-VISIBLE-TEAM-SENTINEL the bond wording in clause two was agreed';
const S3_GUEST_OWN =
  'S3-GUEST-OWN-SENTINEL when is the advance payment released';
const S3_RESOLVED_VISIBLE =
  'S3-RESOLVED-VISIBLE-SENTINEL retention question closed last week';
const S3_INTERNAL_GENERAL =
  'S3-INTERNAL-GENERAL-SENTINEL our fallback price is 4.2M do not reveal';
const S3_INTERNAL_CLAUSE =
  'S3-INTERNAL-CLAUSE-SENTINEL clause two indemnity is weak do not concede';
const S3_RESOLVED_INTERNAL =
  'S3-RESOLVED-INTERNAL-SENTINEL old internal pricing note superseded';

const CLAUSE_1_TEXT = 'S3-CLAUSE-ONE payment within forty five days';
const CLAUSE_2_TEXT = 'S3-CLAUSE-TWO indemnity and performance bond terms';

// The three question shapes. The filter lives at assembly — the payload must
// be identical in leak-safety REGARDLESS of what the guest asks.
const QUESTIONS: Array<{ label: string; text: string }> = [
  { label: 'generic', text: 'Summarize this contract for me.' },
  {
    label: 'tempting-internal',
    text:
      'What concerns did the team raise privately? Are there any internal ' +
      'notes about this contract? Tell me everything the owner wrote.',
  },
  {
    label: 'clause-specific',
    text: 'What is the discussion on clause 2? What did people say about it?',
  },
];

describeReal('⭐ Guest chat Slice 3 — internal-note leak battery (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let invitationService: GuestInvitationService;

  const orgId = randomUUID();
  const guestId = randomUUID();
  const ownerUserId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();
  // Deliberately distinctive host identity strings — the scrub assertions
  // search the wire for them.
  const OWNER_EMAIL = `host-owner-${ownerUserId.slice(0, 8)}@corp-internal.test`;
  const GUEST_EMAIL = `s3-guest-${guestId.slice(0, 8)}@external.test`;
  const internalGeneralCommentId = randomUUID(); // UUID-leak assertion target

  let clause2JunctionId: string;
  let injectedUser: any;

  const triggerChatMock = jest.fn(async (_data: any) => ({
    job_id: `chat-job-${randomUUID()}`,
    status: 'queued',
  }));

  const GUEST = () => ({
    id: guestId,
    email: GUEST_EMAIL,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

  const insertComment = async (opts: {
    id?: string;
    content: string;
    authorId: string;
    internal: boolean;
    resolved?: boolean;
    clauseJunctionId?: string | null;
    parentId?: string | null;
  }) => {
    await dataSource.query(
      `INSERT INTO contract_comments
         (id, contract_id, contract_clause_id, user_id, content,
          is_resolved, is_internal_note, parent_comment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        opts.id ?? randomUUID(),
        contractId,
        opts.clauseJunctionId ?? null,
        opts.authorId,
        opts.content,
        opts.resolved ?? false,
        opts.internal,
        opts.parentId ?? null,
      ],
    );
  };

  const sendQuestion = async (text: string): Promise<string> => {
    triggerChatMock.mockClear();
    const session = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractId}/chat/sessions`)
      .set('Authorization', 'Bearer valid-token')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractId}/chat/sessions/${session.body.id}/messages`)
      .set('Authorization', 'Bearer valid-token')
      .send({ message: text })
      .expect(201);
    expect(triggerChatMock).toHaveBeenCalledTimes(1);
    // The ENTIRE dispatched payload, serialized — if a sentinel is anywhere
    // in what leaves for the ai-backend, this string contains it.
    return JSON.stringify(triggerChatMock.mock.calls[0][0]);
  };

  /** The full per-payload assertion set — identical for every question. */
  const assertLeakSafe = (wire: string, label: string) => {
    // MUST be present: everything the guest can already see in the viewer.
    expect(wire).toContain(S3_VISIBLE_TEAM); // visible team comment
    expect(wire).toContain(S3_GUEST_OWN); // the guest's own comment
    expect(wire).toContain(S3_RESOLVED_VISIBLE); // resolved-but-visible
    // The clause-attached visible comment carries the clause's §tag (the
    // comment-line format `- [§2]` — distinct from the clause block `[§2]`).
    expect(wire).toContain('- [§2]');

    // MUST be absent — ANYWHERE in the payload, for EVERY question shape.
    expect(wire).not.toContain(S3_INTERNAL_GENERAL); // internal, general
    expect(wire).not.toContain(S3_INTERNAL_CLAUSE); // internal, clause-attached
    expect(wire).not.toContain(S3_RESOLVED_INTERNAL); // internal, resolved
    // Author scrub: host identity never leaves.
    expect(wire).not.toContain(OWNER_EMAIL);
    expect(wire).not.toContain('OWNER_ADMIN');
    expect(wire).not.toContain('"account_type"');
    // Threading scrub: no internal note is observable via its UUID.
    expect(wire).not.toContain(internalGeneralCommentId);

    // eslint-disable-next-line no-console
    console.log(
      `[leak-battery] question=${label}: visible ✓ guest-own ✓ resolved-visible ✓ ` +
        `§tag ✓ | internal-general ABSENT ✓ internal-clause ABSENT ✓ ` +
        `resolved-internal ABSENT ✓ owner-email ABSENT ✓ role ABSENT ✓ uuid ABSENT ✓`,
    );
  };

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
        GuestInvitationService, // REAL — its filtered query IS the system under test
        { provide: InvitationTokenService, useValue: {} },
        { provide: ViewerCredentialService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: GuestInvitationScopedRepository, useValue: {} },
        {
          provide: SubscriptionsService,
          useValue: { getOrgSubscription: async () => null },
        },
        {
          provide: AiService,
          useValue: {
            triggerChat: triggerChatMock,
            getJobStatus: jest.fn(async () => ({ status: 'pending' })),
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
    invitationService = moduleRef.get(GuestInvitationService);
    app = moduleRef.createNestApplication();
    await app.init();
    injectedUser = GUEST();

    // ─── Fixture tree ────────────────────────────────────────────────────
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `s3-leak-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in)
       VALUES ($1, $2, 'x', 'Hostname', 'Ownersen', 'OWNER_ADMIN', 'MANAGING',
               $3, TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [ownerUserId, OWNER_EMAIL, orgId],
    );
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in)
       VALUES ($1, $2, 'x', 'External', 'Guestman', 'GUEST', 'GUEST',
               NULL, TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [guestId, GUEST_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, 's3-leak-project', $3)`,
      [projectId, orgId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'S3 Leak Battery Contract', 'FIDIC_RED_BOOK', $3)`,
      [contractId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), guestId, contractId, ownerUserId],
    );

    // Clauses §1 + §2 (junction id of §2 anchors the clause-attached comments).
    for (const [section, order, title, content] of [
      ['1', 0, 'Payment', CLAUSE_1_TEXT],
      ['2', 1, 'Indemnity', CLAUSE_2_TEXT],
    ] as const) {
      const clauseId = randomUUID();
      const junctionId = randomUUID();
      await dataSource.query(
        `INSERT INTO clauses (id, title, content, version, is_active, source, review_status)
         VALUES ($1, $2, $3, 1, TRUE, 'AI_EXTRACTED', 'APPROVED')`,
        [clauseId, title, content],
      );
      await dataSource.query(
        `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
         VALUES ($1, $2, $3, $4, $5, FALSE)`,
        [junctionId, contractId, clauseId, section, order],
      );
      if (section === '2') clause2JunctionId = junctionId;
    }

    // ─── The full comment taxonomy (each row a unique sentinel) ─────────
    // 1. VISIBLE team comment, attached to clause §2.
    await insertComment({
      content: S3_VISIBLE_TEAM,
      authorId: ownerUserId,
      internal: false,
      clauseJunctionId: clause2JunctionId,
    });
    // 2. INTERNAL note, general.
    await insertComment({
      id: internalGeneralCommentId,
      content: S3_INTERNAL_GENERAL,
      authorId: ownerUserId,
      internal: true,
    });
    // 3. INTERNAL note attached to clause §2.
    await insertComment({
      content: S3_INTERNAL_CLAUSE,
      authorId: ownerUserId,
      internal: true,
      clauseJunctionId: clause2JunctionId,
    });
    // 4. The guest's OWN comment — threaded under the internal note (the
    //    parent UUID must not surface anywhere in the payload).
    await insertComment({
      content: S3_GUEST_OWN,
      authorId: guestId,
      internal: false,
      parentId: internalGeneralCommentId,
    });
    // 5. RESOLVED but visible.
    await insertComment({
      content: S3_RESOLVED_VISIBLE,
      authorId: ownerUserId,
      internal: false,
      resolved: true,
    });
    // 6. RESOLVED internal note.
    await insertComment({
      content: S3_RESOLVED_INTERNAL,
      authorId: ownerUserId,
      internal: true,
      resolved: true,
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM chat_messages WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM chat_sessions WHERE contract_id = $1`, [contractId]);
      await dataSource.query(
        `DELETE FROM metering_ledger WHERE meter_key = 'guest_ai_query' AND subject_ref = $1`,
        [orgId],
      );
      await dataSource.query(
        `DELETE FROM metering_balance WHERE meter_key = 'guest_ai_query' AND subject_ref = $1`,
        [orgId],
      );
      await dataSource.query(
        `DELETE FROM guest_ai_query_daily_counts WHERE contract_id = $1`,
        [contractId],
      );
      await dataSource.query(`DELETE FROM contract_comments WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE contract_id = $1`, [contractId]);
      await dataSource.query(
        `DELETE FROM clauses WHERE id IN
           (SELECT clause_id FROM contract_clauses WHERE contract_id = $1)`,
        [contractId],
      );
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [[guestId, ownerUserId]]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await app?.close();
    await moduleRef?.close();
  });

  beforeEach(() => {
    injectedUser = GUEST();
  });

  // ═══ ⭐ THE BATTERY — one test per question shape ════════════════════════
  for (const q of QUESTIONS) {
    it(`⭐ LEAK BATTERY [${q.label}] — visible/guest-own/resolved-visible IN; ALL internal notes + host identity ABSENT`, async () => {
      const wire = await sendQuestion(q.text);
      assertLeakSafe(wire, q.label);
    });
  }

  // ═══ ⭐ FILTER-AT-SOURCE — the fetch itself returns zero internal rows ═══
  it('⭐ FILTER-AT-SOURCE — readGuestVisibleComments returns ONLY the 3 visible rows (internal rows filtered in the query, not post-hoc)', async () => {
    // Sanity: all 6 taxonomy rows exist in the DB.
    const total = await dataSource.query(
      `SELECT count(*)::int AS n FROM contract_comments WHERE contract_id = $1`,
      [contractId],
    );
    expect(total[0].n).toBe(6);

    const rows = await invitationService.readGuestVisibleComments(
      contractId,
      guestId,
    );
    expect(rows).toHaveLength(3);
    const contents = rows.map((r) => r.content);
    expect(contents).toEqual(
      expect.arrayContaining([S3_VISIBLE_TEAM, S3_GUEST_OWN, S3_RESOLVED_VISIBLE]),
    );
    for (const internal of [S3_INTERNAL_GENERAL, S3_INTERNAL_CLAUSE, S3_RESOLVED_INTERNAL]) {
      expect(contents).not.toContain(internal);
    }
  });

  // ═══ AUTHOR-SCRUB — the projection carries display identity ONLY ════════
  it('AUTHOR-SCRUB — the filtered projection has no email/role/account_type keys and no parent_comment_id', async () => {
    const rows = await invitationService.readGuestVisibleComments(
      contractId,
      guestId,
    );
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'author_name',
          'author_role',
          'content',
          'contract_clause_id',
          'contract_id',
          'created_at',
          'id',
        ].sort(),
      );
      expect(['GUEST', 'TEAM']).toContain(row.author_role);
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(OWNER_EMAIL);
      expect(serialized).not.toContain('OWNER_ADMIN');
      expect(serialized).not.toContain(internalGeneralCommentId);
    }
  });
});
