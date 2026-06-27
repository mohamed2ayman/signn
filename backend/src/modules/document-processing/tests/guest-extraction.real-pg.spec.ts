import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  DocumentUpload,
  GuestContractAccess,
  RiskAnalysis,
  RiskCategory,
  User,
  UserRole,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';
import { MeteringModule } from '../../metering/metering.module';
import { MeteringService } from '../../metering/services/metering.service';
import { RiskMethodologyResolverService } from '../../risk-analysis/services/risk-methodology-resolver.service';
import { StorageService } from '../../storage/storage.service';
import { DocumentUploadScopedRepository } from '../../scoped-repository/document-upload-scoped.repository';
import { GuestStatusController } from '../../guest-portal/controllers/guest-status.controller';
import { DocumentProcessingService } from '../document-processing.service';

/**
 * Guest extraction completion (Slice 1) — REAL-Postgres proof.
 *
 * This is the NON-mocked-pipeline test (lesson #140): only the AI boundary
 * (AiService.getJobStatus / triggerExtractClauses) is faked deterministically.
 * Everything else is REAL against the live Postgres (sign-postgres): the guest
 * status endpoint, the binding wall, the clause writes, and the metering
 * ledger. The whole pipeline is DRIVEN through the real guest status endpoint —
 * the keystone that nothing else drives for a guest.
 *
 * CI is unit-test ONLY (CLAUDE.md), so this skips LOUDLY when DATABASE_URL is
 * unset — a silent skip would read green without proving anything.
 *
 * GREEN (end-to-end via the guest status endpoint): a bound guest's upload is
 * driven text→clauses→done, reaching CLAUSES_EXTRACTED, with FOUR invariants:
 *   1. clauses written as a SEPARATE proposed set (is_proposed=true, scoped by
 *      source_document_id);
 *   2. the host's ORIGINAL clauses are unchanged (count + order_index intact);
 *   3. the GUEST_UPLOAD reservation is COMMITTED (not released/swept);
 *   4. no order_index collision — the host's live read returns ONLY the
 *      original set, correctly ordered, with the proposed pile excluded.
 * Plus: the party-backfill is a NO-OP for the guest path (the parent contract's
 * party fields are NOT mutated, even though the guest text carries a party
 * marker and the fields start empty).
 *
 * RED: cross-contract → 404; wrong guest (ownership) → 404; unbound guest
 * (binding wall) → 404; managing/viewer principal on the guest endpoint → 403;
 * no credential → 401. Plus the MANAGING path still drives to completion
 * writing LIVE (non-proposed) clauses — proving the refactor left it unchanged.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-extraction] SKIPPING real-Postgres spec (guest-extraction.real-pg.spec.ts): ' +
      'DATABASE_URL unset — this MUST run against Postgres to prove the guest pipeline ' +
      'driver reaches CLAUSES_EXTRACTED, writes a SEPARATE proposed clause set (no ' +
      'order_index collision with the host), COMMITS the GUEST_UPLOAD reservation, and ' +
      'never mutates the parent contract. CI green here does NOT prove it (lesson #140).',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// Guest extracted text carries an Arabic party marker — to PROVE the guest path
// still does NOT backfill the parent contract's party fields (allowPartyBackfill=false).
const GUEST_TEXT_WITH_PARTY_MARKER =
  'بين كل من الشركة الوطنية للمقاولات (طرف أول) و شركة المقاول الفرعي (طرف ثاني). مادة (1) تعريفات.';

// Two deterministic guest "proposed" clauses returned by the faked clause job.
const GUEST_CLAUSES = [
  {
    title: 'Guest Proposed Clause A',
    content: 'Proposed revision A content.',
    clause_type: 'GENERAL',
    section_number: '1',
    confidence: 0.91,
  },
  {
    title: 'Guest Proposed Clause B',
    content: 'Proposed revision B content.',
    clause_type: 'PAYMENT',
    section_number: '2',
    confidence: 0.88,
  },
];

describeReal('Guest extraction completion (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let docService: DocumentProcessingService;
  let contractAccess: ContractAccessService;
  let metering: MeteringService;

  // Fixture refs (deterministic ids for FK-safe cleanup).
  const orgId = randomUUID();
  const ownerUserId = randomUUID(); // managing owner / contract.creator
  const guestUserId = randomUUID(); // bound guest
  const guest2UserId = randomUUID(); // guest with NO binding (binding-wall RED)
  const projectId = randomUUID();
  const contractId = randomUUID(); // guest IS bound
  const contractUnboundId = randomUUID(); // guest is NOT bound (cross-contract RED)
  const contractManagingId = randomUUID(); // managing happy-path (no guest)
  const bindingId = randomUUID();

  // 3 ORIGINAL host clauses on `contractId` — must stay untouched.
  const originalClauseIds = [randomUUID(), randomUUID(), randomUUID()];
  const originalCcIds = [randomUUID(), randomUUID(), randomUUID()];

  // The principal the stubbed JwtAuthGuard injects. Mutated per-test.
  let injectedUser: any;

  // Faked AI boundary — deterministic by job-id prefix.
  const fakeAi = {
    getJobStatus: jest.fn(async (jobId: string) => {
      if (jobId.startsWith('text-job')) {
        return {
          status: 'completed',
          result: { text: GUEST_TEXT_WITH_PARTY_MARKER, page_count: 2 },
        };
      }
      if (jobId.startsWith('clause-job')) {
        return { status: 'completed', result: { clauses: GUEST_CLAUSES } };
      }
      return { status: 'pending' };
    }),
    triggerExtractClauses: jest.fn(async () => ({
      job_id: `clause-job-${randomUUID()}`,
      status: 'pending',
    })),
    triggerExtractText: jest.fn(async () => ({
      job_id: `text-job-${randomUUID()}`,
      status: 'pending',
    })),
  };

  const GUEST_PRINCIPAL = () => ({
    id: guestUserId,
    email: `guest-ext-${guestUserId.slice(0, 8)}@external.test`,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

  const insertUser = async (
    id: string,
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
       VALUES ($1, $2, $3, 'Ext', 'Test', $4, $5, $6,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [
        id,
        `ext-${id.slice(0, 8)}@test.local`,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.guest.ext.test',
        role,
        accountType,
        org,
      ],
    );
  };

  /**
   * Seed a guest document_uploads row in EXTRACTING_TEXT carrying a REAL
   * GUEST_UPLOAD reservation (so terminal success can commit it). Returns the
   * doc id + reservation id.
   */
  const seedGuestDoc = async (opts?: {
    uploadedBy?: string;
    contract?: string;
    status?: string;
    jobId?: string;
  }): Promise<{ docId: string; reservationId: string }> => {
    const uploadedBy = opts?.uploadedBy ?? guestUserId;
    const contract = opts?.contract ?? contractId;
    const status = opts?.status ?? 'EXTRACTING_TEXT';
    const jobId = opts?.jobId ?? `text-job-${randomUUID()}`;
    const reservation = await metering.reserve({
      caller: {
        user_id: uploadedBy,
        jwt_organization_id: orgId,
        account_type: 'GUEST',
      },
      meterKey: MeterKey.GUEST_UPLOAD,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: contract,
      actorRef: uploadedBy,
      metadata: { route: 'POST /guest/contracts/:id/documents' },
    });
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads
         (id, contract_id, organization_id, file_url, file_name,
          processing_status, processing_job_id, reservation_id, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        docId,
        contract,
        orgId,
        `http://x/${docId}.pdf`,
        `${docId}.pdf`,
        status,
        jobId,
        reservation.reservation_id,
        uploadedBy,
      ],
    );
    return { docId, reservationId: reservation.reservation_id };
  };

  const ledgerStatus = async (reservationId: string): Promise<string | null> => {
    const rows = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows[0] ? rows[0].status : null;
  };

  const liveClauseOrder = async (contract: string): Promise<number[]> => {
    const rows = await dataSource.query(
      `SELECT order_index FROM contract_clauses
        WHERE contract_id = $1 AND is_proposed = false
        ORDER BY order_index ASC`,
      [contract],
    );
    return rows.map((r: any) => Number(r.order_index));
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

    // Focused providers (NOT the full DocumentProcessingModule, which pulls
    // ContractsModule → CollaborationGateway and the whole websocket graph).
    // Only what the guest-extraction path actually touches is wired real;
    // unused deps (storage, risk resolver, scoped repo) are stubbed.
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        BullModule.forRoot({
          redis: process.env.REDIS_URL || 'redis://redis:6379',
        }),
        TypeOrmModule.forFeature([
          DocumentUpload,
          Clause,
          ContractClause,
          Contract,
          RiskAnalysis,
          AuditLog,
          RiskCategory,
          GuestContractAccess,
          User,
        ]),
        MeteringModule,
      ],
      controllers: [GuestStatusController],
      providers: [
        DocumentProcessingService,
        ContractAccessService,
        { provide: AiService, useValue: fakeAi },
        { provide: StorageService, useValue: {} },
        { provide: RiskMethodologyResolverService, useValue: {} },
        { provide: DocumentUploadScopedRepository, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardStub)
      .compile();

    dataSource = moduleRef.get(DataSource);
    docService = moduleRef.get(DocumentProcessingService);
    contractAccess = moduleRef.get(ContractAccessService);
    metering = moduleRef.get(MeteringService, { strict: false });
    app = moduleRef.createNestApplication();
    await app.init();

    // ─── Seed the fixture tree (raw SQL; deterministic ids). ──
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `guest-ext-org-${orgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerUserId, 'OWNER_ADMIN', 'MANAGING', orgId);
    await insertUser(guestUserId, 'GUEST', 'GUEST', null);
    await insertUser(guest2UserId, 'GUEST', 'GUEST', null);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, 'guest-ext-project', $3)`,
      [projectId, orgId, ownerUserId],
    );
    // Guest-bound contract — party fields LEFT NULL so the no-op backfill
    // assertion is meaningful.
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Guest-Bound Contract', 'FIDIC_RED_BOOK', $3)`,
      [contractId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Unbound Contract', 'FIDIC_RED_BOOK', $3)`,
      [contractUnboundId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Managing Contract', 'FIDIC_RED_BOOK', $3)`,
      [contractManagingId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [bindingId, guestUserId, contractId, ownerUserId],
    );

    // 3 ORIGINAL host clauses on contractId, order_index 0,1,2 (is_proposed=false).
    for (let i = 0; i < 3; i++) {
      await dataSource.query(
        `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
         VALUES ($1, $2, $3, $4, 'AI_EXTRACTED', 'APPROVED', $5)`,
        [originalClauseIds[i], orgId, `Original Clause ${i}`, `content ${i}`, ownerUserId],
      );
      await dataSource.query(
        `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
         VALUES ($1, $2, $3, $4, false)`,
        [originalCcIds[i], contractId, originalClauseIds[i], i],
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // FK-safe teardown: clauses created from guest/managing docs first
      // (source_document_id → document_uploads), then docs, then the tree.
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id = ANY($1)`,
        [[contractId, contractUnboundId, contractManagingId]],
      );
      await dataSource.query(
        `DELETE FROM clauses WHERE organization_id = $1`,
        [orgId],
      );
      await dataSource.query(
        `DELETE FROM document_uploads WHERE contract_id = ANY($1)`,
        [[contractId, contractUnboundId, contractManagingId]],
      );
      await dataSource.query(`DELETE FROM metering_ledger WHERE subject_ref = $1`, [orgId]);
      await dataSource.query(`DELETE FROM metering_balance WHERE subject_ref = $1`, [orgId]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE id = $1`, [bindingId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractId, contractUnboundId, contractManagingId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [ownerUserId, guestUserId, guest2UserId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await app?.close();
  });

  beforeEach(() => {
    injectedUser = GUEST_PRINCIPAL();
    fakeAi.getJobStatus.mockClear();
    fakeAi.triggerExtractClauses.mockClear();
  });

  // ─── GREEN — end-to-end via the guest status endpoint ──────────────────
  it('GREEN — bound guest upload driven via the guest status endpoint reaches CLAUSES_EXTRACTED; proposed set written; host clauses unchanged; reservation COMMITTED; party-backfill no-op', async () => {
    const { docId, reservationId } = await seedGuestDoc();
    const url = `/guest/contracts/${contractId}/documents/${docId}/status`;

    // First poll: text job completes → clause extraction dispatched.
    const r1 = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer valid-token');
    expect(r1.status).toBe(200);
    expect(r1.body.processing_status).toBe('EXTRACTING_CLAUSES');
    // Sanitized view — never leak host org_id / reservation_id / extracted_text.
    expect(r1.body.organization_id).toBeUndefined();
    expect(r1.body.reservation_id).toBeUndefined();
    expect(r1.body.extracted_text).toBeUndefined();

    // Second poll: clause job completes → CLAUSES_EXTRACTED (terminal).
    const r2 = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer valid-token');
    expect(r2.status).toBe(200);
    expect(r2.body.processing_status).toBe('CLAUSES_EXTRACTED');

    // (1) Proposed clauses written as a SEPARATE set, scoped by source_document_id.
    const proposed = await dataSource.query(
      `SELECT cc.order_index, cc.is_proposed, c.title, c.source_document_id
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE cc.contract_id = $1 AND cc.is_proposed = true
          AND c.source_document_id = $2
        ORDER BY cc.order_index ASC`,
      [contractId, docId],
    );
    expect(proposed).toHaveLength(GUEST_CLAUSES.length);
    expect(proposed.map((p: any) => Number(p.order_index))).toEqual([0, 1]);
    expect(proposed.every((p: any) => p.is_proposed === true)).toBe(true);
    expect(proposed.every((p: any) => p.source_document_id === docId)).toBe(true);
    expect(proposed.map((p: any) => p.title)).toEqual([
      'Guest Proposed Clause A',
      'Guest Proposed Clause B',
    ]);

    // (2) + (4) Host ORIGINAL clauses unchanged + NO order_index collision —
    // the host's live read returns ONLY the original 3, correctly ordered, with
    // the proposed pile excluded.
    expect(await liveClauseOrder(contractId)).toEqual([0, 1, 2]);
    const hostView = await contractAccess.findInOrg(contractId, orgId);
    expect(hostView.contract_clauses).toHaveLength(3);
    expect(
      hostView.contract_clauses.map((cc) => cc.order_index),
    ).toEqual([0, 1, 2]);
    expect(
      hostView.contract_clauses.map((cc) => cc.clause.title).sort(),
    ).toEqual(['Original Clause 0', 'Original Clause 1', 'Original Clause 2']);

    // (3) GUEST_UPLOAD reservation COMMITTED (not released/swept).
    expect(await ledgerStatus(reservationId)).toBe('committed');

    // Party-backfill NO-OP: the guest text carries a party marker AND the
    // contract's party fields started NULL, yet the guest path never mutated them.
    const [contractRow] = await dataSource.query(
      `SELECT party_first_name, party_second_name FROM contracts WHERE id = $1`,
      [contractId],
    );
    expect(contractRow.party_first_name).toBeNull();
    expect(contractRow.party_second_name).toBeNull();
  });

  // ─── GREEN — host-v1 proposed-clauses read surfaces the proposed set ───
  it('GREEN — getProposedClauses (host-v1) returns ONLY the guest doc’s proposed clauses', async () => {
    const { docId } = await seedGuestDoc();
    const url = `/guest/contracts/${contractId}/documents/${docId}/status`;
    await request(app.getHttpServer()).get(url).set('Authorization', 'Bearer valid-token');
    await request(app.getHttpServer()).get(url).set('Authorization', 'Bearer valid-token');

    const proposed = await docService.getProposedClauses(contractId, docId, orgId);
    expect(proposed).toHaveLength(GUEST_CLAUSES.length);
    expect(proposed.every((cc) => cc.is_proposed === true)).toBe(true);
    expect(proposed.every((cc) => cc.clause.source_document_id === docId)).toBe(true);
  });

  // ─── RED — cross-contract via the endpoint → 404 (no existence leak) ───
  it('RED — guest polls a doc under a contract it is not bound to → 404', async () => {
    const { docId } = await seedGuestDoc();
    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractUnboundId}/documents/${docId}/status`)
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
  });

  // ─── RED — managing principal on the guest endpoint → 403 ──────────────
  it('RED — managing principal on the guest status endpoint → 403', async () => {
    const { docId } = await seedGuestDoc();
    injectedUser = {
      id: ownerUserId,
      email: 'owner@managing.test',
      role: UserRole.OWNER_ADMIN,
      organization_id: orgId,
      account_type: AccountType.MANAGING,
    };
    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractId}/documents/${docId}/status`)
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  // ─── RED — viewer-shaped principal (Path A, no account_type=GUEST) → 403 ─
  it('RED — viewer principal on the guest status endpoint → 403', async () => {
    const { docId } = await seedGuestDoc();
    injectedUser = {
      type: 'viewer',
      viewer: { contract_id: contractId, invitation_id: randomUUID() },
    };
    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractId}/documents/${docId}/status`)
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  // ─── RED — no credential → 401 ─────────────────────────────────────────
  it('RED — no credential → 401', async () => {
    const { docId } = await seedGuestDoc();
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractId}/documents/${docId}/status`)
      .expect(401);
  });

  // ─── RED — ownership: doc not uploaded by this guest → 404 (service) ────
  it('RED — a guest cannot drive a doc they did not upload → 404', async () => {
    const { docId } = await seedGuestDoc(); // uploaded_by = guestUserId
    await expect(
      docService.pollAndAdvanceForGuest(docId, contractId, guest2UserId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── RED — binding wall: unbound guest's own doc → 404 (service) ───────
  it('RED — an unbound guest driving their OWN doc is blocked by the binding wall → 404', async () => {
    // guest2 is NOT bound to contractId; their own doc must still 404.
    const { docId } = await seedGuestDoc({
      uploadedBy: guest2UserId,
      contract: contractId,
    });
    await expect(
      docService.pollAndAdvanceForGuest(docId, contractId, guest2UserId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── GREEN — MANAGING path unchanged: drives to completion, LIVE clauses ─
  it('GREEN — managing pollAndAdvance still drives to CLAUSES_EXTRACTED writing LIVE (non-proposed) clauses (findInOrg intact)', async () => {
    // A managing doc on a separate contract, carrying an UPLOAD_EXTRACTION reservation.
    const reservation = await metering.reserve({
      caller: {
        user_id: ownerUserId,
        jwt_organization_id: orgId,
        account_type: 'MANAGING',
      },
      meterKey: MeterKey.UPLOAD_EXTRACTION,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: contractManagingId,
      actorRef: ownerUserId,
      metadata: { route: 'POST /contracts/:contractId/documents' },
    });
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads
         (id, contract_id, organization_id, file_url, file_name,
          processing_status, processing_job_id, reservation_id, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, 'EXTRACTING_TEXT', $6, $7, $8)`,
      [
        docId,
        contractManagingId,
        orgId,
        `http://x/${docId}.pdf`,
        `${docId}.pdf`,
        `text-job-${randomUUID()}`,
        reservation.reservation_id,
        ownerUserId,
      ],
    );

    // Drive the MANAGING route (findInOrg wall) twice → terminal.
    await docService.pollAndAdvance(docId, orgId);
    const done = await docService.pollAndAdvance(docId, orgId);
    expect(done.processing_status).toBe('CLAUSES_EXTRACTED');

    // Managing clauses land in the LIVE set (is_proposed=false), NOT proposed.
    const rows = await dataSource.query(
      `SELECT is_proposed FROM contract_clauses WHERE contract_id = $1`,
      [contractManagingId],
    );
    expect(rows).toHaveLength(GUEST_CLAUSES.length);
    expect(rows.every((r: any) => r.is_proposed === false)).toBe(true);
    // Reservation committed by the unchanged managing terminal-success path.
    expect(await ledgerStatus(reservation.reservation_id)).toBe('committed');
  });

  // ─── GREEN — race closure: a GUEST doc driven via the MANAGING route still
  //     writes PROPOSED clauses (behaviour is intrinsic to the doc, not the
  //     endpoint) — so a host polling a guest's in-progress doc can never
  //     corrupt the live set. ───────────────────────────────────────────────
  it('GREEN — a GUEST-uploaded doc driven via the MANAGING route writes PROPOSED clauses (doc-derived, not endpoint-derived)', async () => {
    const { docId } = await seedGuestDoc(); // uploaded_by = guestUserId (GUEST)

    // Drive via the MANAGING route (findInOrg wall) — the doc's org is the host
    // org, so a host CAN reach it. Twice → terminal.
    await docService.pollAndAdvance(docId, orgId);
    const done = await docService.pollAndAdvance(docId, orgId);
    expect(done.processing_status).toBe('CLAUSES_EXTRACTED');

    // Even though the MANAGING route drove it, the clauses are PROPOSED (the
    // uploader is a GUEST) — never mixed into the host's live set.
    const rows = await dataSource.query(
      `SELECT cc.is_proposed
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE c.source_document_id = $1`,
      [docId],
    );
    expect(rows).toHaveLength(GUEST_CLAUSES.length);
    expect(rows.every((r: any) => r.is_proposed === true)).toBe(true);
    // Host live read still untouched — exactly the original 3.
    expect(await liveClauseOrder(contractId)).toEqual([0, 1, 2]);
  });

  // Count the PROPOSED clause set written for one source document.
  const proposedCountForDoc = async (docId: string): Promise<number> => {
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS c
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE cc.is_proposed = true AND c.source_document_id = $1`,
      [docId],
    );
    return Number(rows[0]?.c ?? 0);
  };

  // ─── ⭐ KEY TEST — the SERVER driver completes the pipeline with NO browser
  //     poll at all (the exact gap that caused the stall). ─────────────────────
  it('⭐ GREEN — SERVER driver (no browser poll) drives a guest upload to CLAUSES_EXTRACTED: proposed set written, host clauses unchanged, GUEST_UPLOAD reservation COMMITTED', async () => {
    const { docId, reservationId } = await seedGuestDoc();

    // Drive ONLY via the SYSTEM driver entry — never via the guest/managing
    // status endpoint, never a browser. Two steps: text→clauses, clauses→done.
    await docService.advanceInProgressAsSystem(docId);
    const done = await docService.advanceInProgressAsSystem(docId);
    expect(done?.processing_status).toBe('CLAUSES_EXTRACTED');

    // Proposed set written, scoped to this guest doc.
    expect(await proposedCountForDoc(docId)).toBe(GUEST_CLAUSES.length);
    const proposed = await dataSource.query(
      `SELECT cc.is_proposed FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE c.source_document_id = $1`,
      [docId],
    );
    expect(proposed.every((r: any) => r.is_proposed === true)).toBe(true);

    // Host's original live clauses untouched + correctly ordered.
    expect(await liveClauseOrder(contractId)).toEqual([0, 1, 2]);

    // GUEST_UPLOAD reservation COMMITTED by the server driver (not swept).
    expect(await ledgerStatus(reservationId)).toBe('committed');
  });

  // ─── ⭐ RACE TEST — two concurrent drivers on the SAME completed doc →
  //     EXACTLY ONE clause set + EXACTLY ONE commit (atomic conditional guard). ─
  it('⭐ GREEN — TWO concurrent drivers finalizing the SAME completed doc → EXACTLY ONE clause set + ONE commit (no double-write)', async () => {
    const { docId, reservationId } = await seedGuestDoc();
    // Step 1 (text→clauses) once, so the doc is at EXTRACTING_CLAUSES with the
    // clause job complete.
    await docService.advanceInProgressAsSystem(docId);

    // Two drivers race the finalize concurrently (server backstop + a browser
    // poll, or two backstop ticks). The atomic conditional UPDATE inside the
    // transaction serialises them on the row lock: exactly one wins.
    const [a, b] = await Promise.all([
      docService.advanceInProgressAsSystem(docId),
      docService.advanceInProgressAsSystem(docId),
    ]);
    expect(a?.processing_status).toBe('CLAUSES_EXTRACTED');
    expect(b?.processing_status).toBe('CLAUSES_EXTRACTED');

    // EXACTLY ONE clause set — never doubled — regardless of the race.
    expect(await proposedCountForDoc(docId)).toBe(GUEST_CLAUSES.length);
    // Reservation committed exactly once (engine commit is status-guarded too).
    expect(await ledgerStatus(reservationId)).toBe('committed');
    // Host live set still pristine.
    expect(await liveClauseOrder(contractId)).toEqual([0, 1, 2]);
  });

  // ─── GREEN — SERVER driver completes a MANAGING upload with LIVE clauses. ────
  it('GREEN — SERVER driver completes a MANAGING upload with LIVE (non-proposed) clauses (doc-derived under the driver)', async () => {
    const reservation = await metering.reserve({
      caller: {
        user_id: ownerUserId,
        jwt_organization_id: orgId,
        account_type: 'MANAGING',
      },
      meterKey: MeterKey.UPLOAD_EXTRACTION,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: contractManagingId,
      actorRef: ownerUserId,
      metadata: { route: 'POST /contracts/:contractId/documents' },
    });
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads
         (id, contract_id, organization_id, file_url, file_name,
          processing_status, processing_job_id, reservation_id, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, 'EXTRACTING_TEXT', $6, $7, $8)`,
      [
        docId,
        contractManagingId,
        orgId,
        `http://x/${docId}.pdf`,
        `${docId}.pdf`,
        `text-job-${randomUUID()}`,
        reservation.reservation_id,
        ownerUserId,
      ],
    );

    await docService.advanceInProgressAsSystem(docId);
    const done = await docService.advanceInProgressAsSystem(docId);
    expect(done?.processing_status).toBe('CLAUSES_EXTRACTED');

    // Scope to THIS doc's clauses (the managing contract is shared with another
    // test) — they must be LIVE (is_proposed=false), the managing default.
    const rows = await dataSource.query(
      `SELECT cc.is_proposed
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE c.source_document_id = $1`,
      [docId],
    );
    expect(rows).toHaveLength(GUEST_CLAUSES.length);
    expect(rows.every((r: any) => r.is_proposed === false)).toBe(true);
    expect(await ledgerStatus(reservation.reservation_id)).toBe('committed');
  });

  // ─── GREEN — AI still pending → driver does NOT advance, no error, no
  //     premature terminal. ────────────────────────────────────────────────────
  it('GREEN — SERVER driver on a doc whose AI job is still pending → no advance, no clauses, no commit, stays in-progress', async () => {
    // A job id that the fake AiService reports as still pending (not text-/clause-).
    const { docId, reservationId } = await seedGuestDoc({
      status: 'EXTRACTING_CLAUSES',
      jobId: `pending-job-${randomUUID()}`,
    });

    const r = await docService.advanceInProgressAsSystem(docId);
    expect(r?.processing_status).toBe('EXTRACTING_CLAUSES'); // unchanged

    expect(await proposedCountForDoc(docId)).toBe(0); // nothing written
    expect(await ledgerStatus(reservationId)).toBe('reserved'); // not committed
  });

  // ─── ⭐ STALENESS BACKSTOP — self-termination for docs that can NEVER complete
  //     (dead/expired AI job that reports PENDING forever). ─────────────────────
  it('⭐ GREEN — SERVER driver FAILs a STALE EXTRACTING_CLAUSES doc (expired AI result → pending forever) → self-terminates + refunds', async () => {
    const { docId, reservationId } = await seedGuestDoc({
      status: 'EXTRACTING_CLAUSES',
      jobId: `pending-job-${randomUUID()}`, // fake reports 'pending'
    });
    // Age it past the staleness window (MAX_IN_PROGRESS_MS = 60 min).
    await dataSource.query(
      `UPDATE document_uploads SET updated_at = now() - interval '90 minutes' WHERE id = $1`,
      [docId],
    );

    const r = await docService.advanceInProgressAsSystem(docId);
    expect(r?.processing_status).toBe('FAILED'); // self-terminated, not stuck forever
    expect(r?.error_message ?? '').toMatch(/timed out/i);
    expect(await proposedCountForDoc(docId)).toBe(0); // no clauses written
    expect(await ledgerStatus(reservationId)).toBe('released'); // reservation refunded
  });

  // ─── GREEN — STALENESS BACKSTOP covers a crash-stranded TEXT_EXTRACTED (no
  //     live job) once it ages out. ────────────────────────────────────────────
  it('GREEN — SERVER driver FAILs a crash-stranded TEXT_EXTRACTED doc (no live job, aged out)', async () => {
    const { docId, reservationId } = await seedGuestDoc();
    // Simulate a crash that left it durably at TEXT_EXTRACTED with no job id.
    await dataSource.query(
      `UPDATE document_uploads
          SET processing_status = 'TEXT_EXTRACTED', processing_job_id = NULL,
              updated_at = now() - interval '90 minutes'
        WHERE id = $1`,
      [docId],
    );

    const r = await docService.advanceInProgressAsSystem(docId);
    expect(r?.processing_status).toBe('FAILED');
    expect(await ledgerStatus(reservationId)).toBe('released');
  });

  // ─── GREEN — a FRESH TEXT_EXTRACTED (transient, no live job) is NOT failed. ──
  it('GREEN — SERVER driver leaves a FRESH TEXT_EXTRACTED doc (transient, within window) untouched', async () => {
    const { docId } = await seedGuestDoc();
    await dataSource.query(
      `UPDATE document_uploads
          SET processing_status = 'TEXT_EXTRACTED', processing_job_id = NULL,
              updated_at = now()
        WHERE id = $1`,
      [docId],
    );
    const r = await docService.advanceInProgressAsSystem(docId);
    expect(r?.processing_status).toBe('TEXT_EXTRACTED'); // not prematurely failed
  });
});
