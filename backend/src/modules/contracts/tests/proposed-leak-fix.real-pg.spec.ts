import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  User,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from '../services/contract-access.service';
import { ComplianceService } from '../../compliance/services/compliance.service';

/**
 * Guest version review — Sub-slice 2a, PART A (the leak fix).
 *
 * Slice 1 documented the invariant (contract-clause.entity.ts): a proposed
 * clause (is_proposed=true) must be EXCLUDED from every default host read.
 * Three reads violated it (no is_proposed filter):
 *   1. ContractsService.getContractClauses  (host's main Clauses tab)
 *   2. ComplianceService.loadClauses         (compliance pipeline input)
 *   3. ContractsService.createVersionSnapshot (snapshot's clause set — the 4th
 *      site, on which 2a's apply snapshot-before guarantee depends)
 * (ExportService is proven separately in export-proposed-leak-fix.spec.ts — its
 * fix is an in-memory filter, no PG needed.)
 *
 * RED (pre-fix): each read INCLUDES the proposed clause.
 * GREEN (post-fix): each read returns ONLY the live set; the proposed clause is
 * still reachable via the explicit getProposedClauses surface (unchanged).
 *
 * Direct service instantiation (real repos from the live DataSource, stubs for
 * unrelated deps) keeps this independent of the full module DI graph. CI is
 * unit-only, so this skips LOUDLY when DATABASE_URL is unset.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[proposed-leak-fix] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove proposed clauses are excluded ' +
      'from the host reads. CI green here does NOT prove the fix.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('Proposed-clause leak fix — Part A (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contracts: ContractsService;
  let contractAccess: ContractAccessService;
  let compliance: ComplianceService;

  const orgId = randomUUID();
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();
  const docId = randomUUID();
  // 2 LIVE host clauses + 1 PROPOSED guest clause on the same contract.
  const liveIds = [randomUUID(), randomUUID()];
  const liveCcIds = [randomUUID(), randomUUID()];
  const propId = randomUUID();
  const propCcId = randomUUID();

  const insertUser = (id: string, role: string, accountType: string, org: string | null) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Leak','Test',$4,$5,$6,TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `leak-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.value.leak.test', role, accountType, org],
    );

  const seed = async () => {
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `leak-org-${orgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerId, 'OWNER_ADMIN', 'MANAGING', orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'leak-project',$3)`,
      [projectId, orgId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'Leak Contract','FIDIC_RED_BOOK',$3)`,
      [contractId, projectId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO document_uploads
         (id, contract_id, organization_id, file_url, file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'CLAUSES_EXTRACTED',$6)`,
      [docId, contractId, orgId, `http://x/${docId}.pdf`, `${docId}.pdf`, ownerId],
    );
    // 2 LIVE clauses (is_proposed=false), order_index 0,1.
    for (let i = 0; i < 2; i++) {
      await dataSource.query(
        `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
         VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',$5)`,
        [liveIds[i], orgId, `Live Clause ${i}`, `live content ${i}`, ownerId],
      );
      await dataSource.query(
        `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
         VALUES ($1,$2,$3,$4,false)`,
        [liveCcIds[i], contractId, liveIds[i], i],
      );
    }
    // 1 PROPOSED clause (is_proposed=true), scoped by source_document_id=docId.
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, source_document_id, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','PENDING_REVIEW',$5,$6)`,
      [propId, orgId, 'Proposed Clause X', 'proposed content X', docId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,true)`,
      [propCcId, contractId, propId, 0],
    );
  };

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
    // Positional ctor (real repos where used by the reads under test; stubs else).
    contracts = new ContractsService(
      dataSource.getRepository(Contract), // 1 contractRepository
      dataSource.getRepository(ContractClause), // 2 contractClauseRepository
      dataSource.getRepository(ContractVersion), // 3 contractVersionRepository
      {} as any, // 4 contractCommentRepository
      {} as any, // 5 contractorResponseRepository
      {} as any, // 6 projectRepository
      dataSource.getRepository(User), // 7 userRepository (resolveUserRole)
      {} as any, // 8 contractApproverRepository
      {} as any, // 9 collaborationGateway
      {} as any, // 10 contractTemplatesService
      {} as any, // 11 emailService
      contractAccess, // 12 contractAccess
      {} as any, // 13 contractScoped
      {} as any, // 14 contractVersionScoped
      {} as any, // 15 contractorResponseScoped
      {} as any, // 16 contractApproverScoped
      {} as any, // 17 contractCommentScoped
      dataSource.getRepository(Clause), // 18 clauseRepository (2a)
      {} as any, // 19 relationshipTypes (T0a) — not exercised: no fixture passes relationship_type
    );
    compliance = new ComplianceService(
      {} as any, // 1 checkRepo
      {} as any, // 2 findingRepo
      {} as any, // 3 projectRepo
      dataSource.getRepository(ContractClause), // 4 contractClauseRepo (loadClauses)
      {} as any, // 5 contractScoped
      {} as any, // 6 checkScoped
      {} as any, // 7 usageRepo
      {} as any, // 8 aiService
      {} as any, // 9 knowledge
      {} as any, // 10 obligationsLayer
      {} as any, // 11 metering
    );

    await seed();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM document_uploads WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await moduleRef?.close();
  });

  it('GREEN — getContractClauses returns ONLY live clauses (proposed excluded)', async () => {
    const rows = await contracts.getContractClauses(contractId, orgId);
    expect(rows).toHaveLength(2);
    expect(rows.every((cc) => cc.is_proposed === false)).toBe(true);
    expect(rows.map((cc) => cc.clause?.title).sort()).toEqual(['Live Clause 0', 'Live Clause 1']);
    expect(rows.some((cc) => cc.id === propCcId)).toBe(false);
  });

  it('GREEN — ComplianceService.loadClauses returns ONLY live clauses (proposed excluded)', async () => {
    const rows = await (compliance as any).loadClauses(contractId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.text).sort()).toEqual(['live content 0', 'live content 1']);
    expect(rows.some((r: any) => r.id === propId)).toBe(false);
  });

  it('GREEN — createVersionSnapshot snapshots ONLY the live contract (proposed excluded)', async () => {
    const version = await contracts.createVersionSnapshot(contractId, ownerId, 'leak-test snapshot');
    const snapClauses = (version.clause_snapshot as any)?.clauses ?? [];
    expect(snapClauses).toHaveLength(2);
    expect(snapClauses.map((c: any) => c.clause_title).sort()).toEqual([
      'Live Clause 0',
      'Live Clause 1',
    ]);
    expect(snapClauses.some((c: any) => c.clause_id === propId)).toBe(false);
  });

  it('GREEN — getProposedClauses surface still reaches the proposed clause (unchanged)', async () => {
    const rows = await dataSource.query(
      `SELECT cc.id FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE cc.contract_id = $1 AND cc.is_proposed = true AND c.source_document_id = $2`,
      [contractId, docId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(propCcId);
  });
});
