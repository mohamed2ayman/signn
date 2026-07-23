import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  ContractComment,
  ContractVersion,
  GuestContractAccess,
  RiskAnalysis,
  User,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from '../services/contract-access.service';
import { ContractPinningService } from '../services/contract-pinning.service';
import { ClausesService } from '../../clauses/clauses.service';
import { DocumentProcessingService } from '../../document-processing/document-processing.service';
import { RiskRephraseService } from '../../risk-analysis/services/risk-rephrase.service';
import { GuestUploadService } from '../../guest-portal/services/guest-upload.service';

/**
 * Signed-state pinning — Slice 2 (ENFORCEMENT), real Postgres.
 *
 * Once a contract is pinned (Slice 1), every LEGAL-CONTENT mutation must be
 * rejected with 409 CONTRACT_PINNED and leave the row UNCHANGED, while the
 * operational layer (comments, lifecycle ACTIVE→COMPLETED, risk status)
 * stays writable, and tenancy still resolves FIRST (cross-org → 404, never
 * a CONTRACT_PINNED leak).
 *
 * RED→GREEN: before the guard exists, every freeze-set call below SUCCEEDS
 * on a pinned contract (the mutations land) — the ⭐ tests fail. GREEN after
 * wiring proves the freeze is real, on real Postgres (lesson #140: the
 * conditional guards + row-unchanged assertions are SQL-level facts).
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[pinning-enforcement] SKIPPING real-Postgres spec: DATABASE_URL unset.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const expectContractPinned = async (p: Promise<unknown>): Promise<void> => {
  await expect(p).rejects.toMatchObject({
    response: expect.objectContaining({ error: 'CONTRACT_PINNED' }),
    status: 409,
  });
};

describeReal('Signed-state pinning — Slice 2 enforcement (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contractAccess: ContractAccessService;
  let contractsService: ContractsService;
  let pinning: ContractPinningService;
  let clausesService: ClausesService;
  let docProcessing: DocumentProcessingService;
  let rephrase: RiskRephraseService;
  let guestUpload: GuestUploadService;

  const aiServiceStub = {
    getJobStatus: jest.fn(),
    extractText: jest.fn(),
    extractClauses: jest.fn(),
  };
  const meteringStub = {
    reserve: jest.fn(),
    commit: jest.fn().mockResolvedValue({ applied: true, status: 'committed' }),
    release: jest.fn().mockResolvedValue({ applied: true, status: 'released' }),
  };
  const collaborationStub = {
    emitClauseAdded: jest.fn(),
    emitClauseUpdated: jest.fn(),
    emitClauseRemoved: jest.fn(),
    emitStatusChanged: jest.fn(),
    emitCommentAdded: jest.fn(),
  };

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ownerId = randomUUID();
  const otherOrgUserId = randomUUID();
  const guestId = randomUUID();
  const projectId = randomUUID();

  const contractIds: string[] = [];

  const insertUser = (
    id: string,
    org: string | null,
    role = 'OWNER_ADMIN',
    accountType = 'MANAGING',
  ) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Enforce','Test',$4,$5,$6,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [
        id,
        `enforce-${id.slice(0, 8)}@test.local`,
        '$2a$10$dummy.hash.placeholder.enforce',
        role,
        accountType,
        org,
      ],
    );

  const insertContract = async (status: string): Promise<string> => {
    const id = randomUUID();
    contractIds.push(id);
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by, status,
                              party_first_name, party_second_name)
       VALUES ($1,$2,'Enforce Contract','FIDIC_RED_BOOK_2017',$3,$4,'Party A','Party B')`,
      [id, projectId, ownerId, status],
    );
    return id;
  };

  /** Seed a LIVE clause; returns { clauseId, ccId }. */
  const seedClause = async (
    contractId: string,
    title: string,
    content: string,
    order: number,
    isProposed = false,
  ) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',1,TRUE,$5)`,
      [clauseId, orgId, title, content, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ccId, contractId, clauseId, String(order + 1), order, isProposed],
    );
    return { clauseId, ccId };
  };

  /** Pin via the REAL Slice-1 shared pin operation (manual door). */
  const pinContract = async (contractId: string) =>
    pinning.markAsSigned(contractId, ownerId, orgId);

  /** A pinned contract with one live clause, ready for enforcement probes. */
  const makePinnedContract = async () => {
    const contractId = await insertContract('APPROVED');
    const clause = await seedClause(contractId, 'Frozen clause', 'frozen content', 0);
    await pinContract(contractId);
    return { contractId, ...clause };
  };

  const contractRow = async (id: string) =>
    (
      await dataSource.query(
        `SELECT name, status, signature_status, party_first_name, party_second_name,
                pinned_version_id, pinned_content_hash
           FROM contracts WHERE id = $1`,
        [id],
      )
    )[0];

  const clauseRow = async (id: string) =>
    (
      await dataSource.query(
        `SELECT title, content, review_status, is_active FROM clauses WHERE id = $1`,
        [id],
      )
    )[0];

  const liveCcCount = async (contractId: string) =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM contract_clauses WHERE contract_id = $1`,
          [contractId],
        )
      )[0].n,
    );

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);

    contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );

    const contractScopedStub = {
      scopedFindByIdOrThrow: async (id: string) =>
        dataSource.getRepository(Contract).findOneOrFail({ where: { id } }),
    };

    contractsService = new ContractsService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(ContractVersion),
      dataSource.getRepository(ContractComment),
      {} as any,
      {} as any,
      dataSource.getRepository(User),
      {} as any,
      collaborationStub as any,
      {} as any,
      {} as any,
      contractAccess,
      contractScopedStub as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(Clause),
      {} as any, // 19 relationshipTypes (T0a) — not exercised: no fixture passes relationship_type
      {} as any, // 20 negotiationStatus (7.19 S2) — share hook not exercised here
    );

    pinning = new ContractPinningService(
      dataSource,
      contractsService,
      contractAccess,
      dataSource.getRepository(AuditLog),
    );

    clausesService = new (ClausesService as any)(
      dataSource.getRepository(Clause),
    );

    const documentScopedStub = {
      scopedFindByIdOrThrow: async (id: string) =>
        dataSource
          .getRepository('DocumentUpload' as any)
          .findOneOrFail({ where: { id } as any }),
    };

    docProcessing = new (DocumentProcessingService as any)(
      dataSource.getRepository('DocumentUpload' as any),
      dataSource.getRepository(Clause),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(Contract),
      dataSource.getRepository(RiskAnalysis),
      dataSource.getRepository(AuditLog),
      dataSource.getRepository('RiskCategory' as any),
      { uploadFile: jest.fn() } as any, // storage
      aiServiceStub as any,
      {} as any, // riskResolver
      contractAccess,
      meteringStub as any,
      documentScopedStub as any,
      dataSource.getRepository(User),
    );

    rephrase = new (RiskRephraseService as any)(
      dataSource.getRepository(RiskAnalysis),
      dataSource.getRepository(Clause),
      dataSource.getRepository(ContractClause),
      contractAccess,
      aiServiceStub as any,
    );

    guestUpload = new (GuestUploadService as any)(
      dataSource,
      contractAccess,
      docProcessing,
      { dispatch: jest.fn() } as any, // notification dispatch (never reached on pinned)
      dataSource.getRepository(User),
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `enforce-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      otherOrgId,
      `enforce-other-${otherOrgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerId, orgId);
    await insertUser(otherOrgUserId, otherOrgId);
    await insertUser(guestId, null, 'GUEST', 'GUEST');
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'enforce-project',$3)`,
      [projectId, orgId, ownerId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `UPDATE contracts SET pinned_version_id = NULL WHERE id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM guest_upload_daily_counts WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM risk_analyses WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM document_uploads WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM contract_comments WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [ownerId, otherOrgUserId, guestId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgId, otherOrgId],
      ]);
    }
    await moduleRef?.close();
  });

  // ══════════════════════════════════════════════════════════════════
  // ContractsService freeze-set paths
  // ══════════════════════════════════════════════════════════════════

  it('⭐ update (PUT /contracts/:id): pinned → 409 CONTRACT_PINNED, row unchanged; unpinned → works; cross-org → 404 first', async () => {
    const { contractId } = await makePinnedContract();
    const before = await contractRow(contractId);

    await expectContractPinned(
      contractsService.update(contractId, { name: 'MUTATED NAME' } as any, orgId),
    );
    expect((await contractRow(contractId)).name).toBe(before.name);

    // (iii) cross-org caller → tenancy wins: 404, never a CONTRACT_PINNED leak.
    await expect(
      contractsService.update(contractId, { name: 'X' } as any, otherOrgId),
    ).rejects.toThrow(NotFoundException);

    // (ii) regression — unpinned contract updates exactly as before.
    const freeId = await insertContract('DRAFT');
    const updated = await contractsService.update(freeId, { name: 'Renamed OK' } as any, orgId);
    expect(updated.name).toBe('Renamed OK');
  });

  it('⭐ updateParties (PUT /contracts/:id/parties): pinned → 409, parties unchanged; unpinned → works', async () => {
    const { contractId } = await makePinnedContract();
    await expectContractPinned(
      contractsService.updateParties(contractId, { party_first_name: 'TAMPER' }, orgId),
    );
    expect((await contractRow(contractId)).party_first_name).toBe('Party A');

    const freeId = await insertContract('DRAFT');
    const updated = await contractsService.updateParties(
      freeId,
      { party_first_name: 'New Party' },
      orgId,
    );
    expect(updated.party_first_name).toBe('New Party');
  });

  it('⭐ addClause (POST /contracts/:id/clauses): pinned → 409, no junction row added; unpinned → works', async () => {
    const { contractId } = await makePinnedContract();
    const lib = await seedClause(await insertContract('DRAFT'), 'Lib', 'lib content', 0);
    const before = await liveCcCount(contractId);

    await expectContractPinned(
      contractsService.addClause(contractId, { clause_id: lib.clauseId } as any, orgId, ownerId),
    );
    expect(await liveCcCount(contractId)).toBe(before);
  });

  it('⭐ updateContractClause (PUT /contracts/:id/clauses/:ccId): pinned → 409, junction unchanged; unpinned → works', async () => {
    const { contractId, ccId } = await makePinnedContract();
    await expectContractPinned(
      contractsService.updateContractClause(
        contractId,
        ccId,
        { section_number: '99', customizations: { hacked: true } } as any,
        ownerId,
        orgId,
      ),
    );
    const cc = (
      await dataSource.query(`SELECT section_number, customizations FROM contract_clauses WHERE id = $1`, [ccId])
    )[0];
    expect(cc.section_number).toBe('1');
    expect(cc.customizations).toBeNull();

    // (ii) unpinned regression
    const freeId = await insertContract('DRAFT');
    const freeClause = await seedClause(freeId, 'free', 'free content', 0);
    const saved = await contractsService.updateContractClause(
      freeId,
      freeClause.ccId,
      { section_number: '7' } as any,
      ownerId,
      orgId,
    );
    expect(saved.section_number).toBe('7');
  });

  it('⭐ removeClause (DELETE /contracts/:id/clauses/:ccId): pinned → 409, junction survives', async () => {
    const { contractId, ccId } = await makePinnedContract();
    await expectContractPinned(
      contractsService.removeClause(contractId, ccId, ownerId, orgId),
    );
    expect(await liveCcCount(contractId)).toBe(1);
  });

  it('⭐ reorderClauses (PUT /contracts/:id/clauses/reorder): pinned → 409, order unchanged', async () => {
    const { contractId, ccId } = await makePinnedContract();
    await expectContractPinned(
      contractsService.reorderClauses(contractId, [{ id: ccId, order_index: 42 }], orgId),
    );
    const cc = (
      await dataSource.query(`SELECT order_index FROM contract_clauses WHERE id = $1`, [ccId])
    )[0];
    expect(cc.order_index).toBe(0);
  });

  it('⭐ applyProposedVersion: pinned → 409, proposed set untouched, no promotion', async () => {
    const { contractId } = await makePinnedContract();
    // A guest-proposed clause scoped to a doc.
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,'http://x/p.pdf','p.pdf','CLAUSES_EXTRACTED',$4)`,
      [docId, contractId, orgId, guestId],
    );
    const propClauseId = randomUUID();
    const propCcId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, source_document_id, version, is_active, created_by)
       VALUES ($1,$2,'Prop','proposed content','AI_EXTRACTED','PENDING_REVIEW',$3,1,TRUE,$4)`,
      [propClauseId, orgId, docId, guestId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1,$2,$3,0,true)`,
      [propCcId, contractId, propClauseId],
    );

    await expectContractPinned(
      contractsService.applyProposedVersion(
        contractId,
        docId,
        { decisions: [{ proposed_contract_clause_id: propCcId, action: 'accept' }] } as any,
        ownerId,
        orgId,
      ),
    );
    // Proposed junction still there (not consumed), live set unchanged.
    const prop = await dataSource.query(
      `SELECT count(*)::int n FROM contract_clauses WHERE id = $1 AND is_proposed = true`,
      [propCcId],
    );
    expect(prop[0].n).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════
  // DocumentProcessingService freeze-set paths
  // ══════════════════════════════════════════════════════════════════

  it('⭐ uploadAndProcess: pinned → 409 BEFORE metering reserve, no doc row; cross-org → 404 first', async () => {
    const { contractId } = await makePinnedContract();
    meteringStub.reserve.mockClear();

    await expectContractPinned(
      docProcessing.uploadAndProcess(
        contractId,
        { originalname: 'x.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF') } as any,
        ownerId,
        orgId,
      ),
    );
    expect(meteringStub.reserve).not.toHaveBeenCalled();
    const docs = await dataSource.query(
      `SELECT count(*)::int n FROM document_uploads WHERE contract_id = $1`,
      [contractId],
    );
    expect(docs[0].n).toBe(0);

    // (iii) cross-org → 404 (tenancy first, no pin leak)
    await expect(
      docProcessing.uploadAndProcess(
        contractId,
        { originalname: 'x.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF') } as any,
        otherOrgUserId,
        otherOrgId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('⭐ reprocess: pinned → 409, no new reservation', async () => {
    const { contractId } = await makePinnedContract();
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,'http://x/r.pdf','r.pdf','FAILED',$4)`,
      [docId, contractId, orgId, ownerId],
    );
    meteringStub.reserve.mockClear();
    await expectContractPinned(docProcessing.reprocess(docId, orgId));
    expect(meteringStub.reserve).not.toHaveBeenCalled();
  });

  it('⭐ updateExtractedText: pinned → 409, text unchanged', async () => {
    const { contractId } = await makePinnedContract();
    const docId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name, processing_status, extracted_text, uploaded_by)
       VALUES ($1,$2,$3,'http://x/t.pdf','t.pdf','CLAUSES_EXTRACTED','original text',$4)`,
      [docId, contractId, orgId, ownerId],
    );
    await expectContractPinned(
      docProcessing.updateExtractedText(docId, orgId, 'TAMPERED text'),
    );
    const row = await dataSource.query(
      `SELECT extracted_text FROM document_uploads WHERE id = $1`,
      [docId],
    );
    expect(row[0].extracted_text).toBe('original text');
  });

  it('⭐ updateClauseReview + bulkApproveReview: clause referenced by a pinned contract → 409, clause unchanged; unpinned clause → works', async () => {
    const { contractId, clauseId } = await makePinnedContract();
    void contractId;

    await expectContractPinned(
      docProcessing.updateClauseReview(
        clauseId,
        { review_status: 'APPROVED' as any, content: 'TAMPERED via review' },
        ownerId,
      ),
    );
    expect((await clauseRow(clauseId)).content).toBe('frozen content');

    await expectContractPinned(docProcessing.bulkApproveReview([clauseId], ownerId));

    // (ii) a clause on an UNPINNED contract still reviews fine.
    const freeId = await insertContract('DRAFT');
    const free = await seedClause(freeId, 'free-review', 'reviewable', 0);
    const updated = await docProcessing.updateClauseReview(
      free.clauseId,
      { review_status: 'APPROVED' as any, content: 'edited in review' },
      ownerId,
    );
    expect(updated.content).toBe('edited in review');
  });

  it('⭐ finalizeReview: pinned → 409 before any reserve/dispatch', async () => {
    const { contractId } = await makePinnedContract();
    meteringStub.reserve.mockClear();
    await expectContractPinned(
      docProcessing.finalizeReview(contractId, orgId, { user_id: ownerId }),
    );
    expect(meteringStub.reserve).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // (iv) SYSTEM driver — scheduler advance path
  // ══════════════════════════════════════════════════════════════════

  it('⭐ (iv) scheduler advance: pinned contract with a completed clause job → writes NOTHING, doc terminal-FAILED, reservation released', async () => {
    const { contractId } = await makePinnedContract();
    const docId = randomUUID();
    const reservationId = randomUUID();
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name,
                                     processing_status, processing_job_id, reservation_id, uploaded_by)
       VALUES ($1,$2,$3,'http://x/s.pdf','s.pdf','EXTRACTING_CLAUSES','job-pinned-1',$4,$5)`,
      [docId, contractId, orgId, reservationId, ownerId],
    );
    aiServiceStub.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: {
        clauses: [
          { title: 'Sneaky', content: 'clause written after signing', clause_type: 'GENERAL', confidence: 0.9 },
        ],
      },
    });
    meteringStub.release.mockClear();

    const ccBefore = await liveCcCount(contractId);
    await docProcessing.advanceInProgressAsSystem(docId);

    // NOTHING written to clauses.
    expect(await liveCcCount(contractId)).toBe(ccBefore);
    // Doc terminalized (never re-polled forever), loudly attributed to the pin.
    const doc = (
      await dataSource.query(
        `SELECT processing_status, error_message FROM document_uploads WHERE id = $1`,
        [docId],
      )
    )[0];
    expect(doc.processing_status).toBe('FAILED');
    expect(doc.error_message).toContain('CONTRACT_PINNED');
    // Reservation refunded.
    expect(meteringStub.release).toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // Risk rephrase writers (PR #137)
  // ══════════════════════════════════════════════════════════════════

  it('⭐ rephrase writers (pollRephrase / editProposal / applyRephrase): pinned → 409, nothing written', async () => {
    const { contractId, ccId } = await makePinnedContract();
    const riskId = randomUUID();
    await dataSource.query(
      `INSERT INTO risk_analyses (id, contract_id, contract_clause_id, risk_level, risk_category,
                                  description, status, likelihood, impact, risk_score,
                                  likelihood_source, impact_source, is_edited_by_user)
       VALUES ($1,$2,$3,'HIGH','Payment','risk desc','PENDING',3,3,9,'PLATFORM_DEFAULT','PLATFORM_DEFAULT',FALSE)`,
      [riskId, contractId, ccId],
    );

    aiServiceStub.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: { rephrased_content: 'AI rewrite', rephrased_title: 'T' },
    });

    await expectContractPinned(rephrase.pollRephrase(riskId, 'job-x', orgId));
    await expectContractPinned(
      rephrase.editProposal(riskId, { content: 'edited' }, orgId),
    );
    await expectContractPinned(
      rephrase.applyRephrase(riskId, 'accept', orgId, ownerId),
    );

    // No proposed clause was created for the risk.
    const risk = (
      await dataSource.query(
        `SELECT proposed_contract_clause_id FROM risk_analyses WHERE id = $1`,
        [riskId],
      )
    )[0];
    expect(risk.proposed_contract_clause_id).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════
  // Guest upload write path
  // ══════════════════════════════════════════════════════════════════

  it('⭐ guest upload: pinned → 409 CONTRACT_PINNED (guest-facing), daily counter untouched, no doc row', async () => {
    const { contractId } = await makePinnedContract();
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), guestId, contractId, ownerId],
    );

    await expectContractPinned(
      guestUpload.guestUploadNewVersion({
        contractId,
        guest: { id: guestId, account_type: 'GUEST' as any, organization_id: null },
        file: { originalname: 'g.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF') } as any,
      }),
    );

    const counts = await dataSource.query(
      `SELECT count(*)::int n FROM guest_upload_daily_counts WHERE contract_id = $1`,
      [contractId],
    );
    expect(counts[0].n).toBe(0); // guard fired BEFORE the slot claim
    const docs = await dataSource.query(
      `SELECT count(*)::int n FROM document_uploads WHERE contract_id = $1`,
      [contractId],
    );
    expect(docs[0].n).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  // (v) Clause-library backdoor
  // ══════════════════════════════════════════════════════════════════

  it('⭐ (v) clause-library PUT /clauses/:id: clause referenced by a pinned contract → 409, content unchanged; unreferenced clause → works', async () => {
    const { clauseId } = await makePinnedContract();

    await expectContractPinned(
      clausesService.update(clauseId, { content: 'LIBRARY BACKDOOR EDIT' } as any, orgId),
    );
    expect((await clauseRow(clauseId)).content).toBe('frozen content');

    // (ii) a library clause NOT referenced by any pinned contract stays editable.
    const freeId = await insertContract('DRAFT');
    const free = await seedClause(freeId, 'editable', 'editable content', 0);
    const updated = await clausesService.update(
      free.clauseId,
      { content: 'edited freely' } as any,
      orgId,
    );
    expect(updated.content).toBe('edited freely');
  });

  // ══════════════════════════════════════════════════════════════════
  // Operational layer stays WRITABLE on a pinned contract
  // ══════════════════════════════════════════════════════════════════

  it('⭐ operational layer on a PINNED contract stays writable: comments + lifecycle ACTIVE→COMPLETED', async () => {
    const { contractId } = await makePinnedContract();

    // Comments (managing) — allowed.
    const comment = await contractsService.addComment(
      contractId,
      { content: 'post-signature operational note' } as any,
      ownerId,
      orgId,
    );
    expect(comment.id).toBeDefined();

    // Lifecycle ACTIVE → COMPLETED — allowed (pin survives).
    const updated = await contractsService.updateStatus(
      contractId,
      { status: 'COMPLETED' } as any,
      ownerId,
      orgId,
    );
    expect(updated.status).toBe('COMPLETED');
    const row = await contractRow(contractId);
    expect(row.pinned_version_id).not.toBeNull();
    expect(row.signature_status).toBe('FULLY_EXECUTED');
  });

  // ══════════════════════════════════════════════════════════════════
  // (vi) Tamper detection — verifyContractPin
  // ══════════════════════════════════════════════════════════════════

  it('⭐ (vi) verifyContractPin: clean pin verifies; a DIRECT DB edit of a pinned clause fails verification loudly', async () => {
    const { contractId, clauseId } = await makePinnedContract();

    const clean = await (pinning as any).verifyContractPin(contractId, orgId);
    expect(clean.pinned).toBe(true);
    expect(clean.valid).toBe(true);

    // Tamper straight past the API layer (raw SQL — the guard can't stop this;
    // the HASH catches it).
    await dataSource.query(`UPDATE clauses SET content = 'tampered at the DB' WHERE id = $1`, [clauseId]);

    const tampered = await (pinning as any).verifyContractPin(contractId, orgId);
    expect(tampered.pinned).toBe(true);
    expect(tampered.valid).toBe(false);
    expect(tampered.live_hash).not.toBe(tampered.pinned_content_hash);
  });
});
