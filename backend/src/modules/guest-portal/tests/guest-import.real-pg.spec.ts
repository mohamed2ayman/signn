import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  Project,
  User,
} from '../../../database/entities';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestImportService } from '../services/guest-import.service';
import { GuestImportController } from '../controllers/guest-import.controller';

/**
 * ⭐ Feature #8d — POST /guest/contracts/:id/import (real Postgres).
 *
 * The FIRST write-path on the shared-with-me track: a bound caller copies a
 * shared contract into THEIR OWN org. Proves the locked invariants:
 *
 *   1. CORRECT COPY — a managing user bound to a source contract in org B
 *      imports into their own project in org A → a NEW contract in org A with
 *      row-identical clause content (title/content/section/order), the party
 *      names, contract_type and name; status = fresh DRAFT (source is
 *      ACTIVE + FULLY_EXECUTED + pin-marked); unsigned + unpinned; fresh
 *      Clause rows minted in org A (never reusing source clause ids);
 *      creation_flow = 'IMPORT'; a real V1 CREATED snapshot.
 *   2. THE SOURCE IS UNTOUCHED — the source contract row, clauses, junctions
 *      and version count are byte-identical before/after the import.
 *   3. GUEST-SCOPED SOURCE (the security core) — internal-note comments,
 *      risk findings, obligations and PROPOSED clauses seeded on the source
 *      appear NOWHERE in the copy (the copy came from the guest-scoped read,
 *      not a privileged one).
 *   4. ATOMICITY — a failure mid-copy (the version snapshot, the LAST step
 *      inside the transaction) rolls back EVERYTHING: no orphan contract, no
 *      partial clauses, no junctions.
 *   5. DESTINATION OWNERSHIP — importing into a project of ANOTHER org
 *      (including the SHARING org's own project) → 404, no copy.
 *   6. BINDING WALL — no binding → uniform 404 (Contract not found), no
 *      copy; a bound GUEST account (no org) → 404 (Project not found), no
 *      copy (nothing to import into).
 *   7. REVOKED — binding deleted, then import → 404, no partial copy.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-import] SKIPPING guest-import.real-pg.spec.ts: DATABASE_URL ' +
      'unset — the copy-correctness + source-untouched + guest-scoped-source ' +
      '+ atomicity invariants MUST be proven against real Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(120_000);

const tag = randomUUID().slice(0, 8);
const LIVE_1 = `LIVE-CLAUSE-ONE-${tag} — شرط الدفع الأول`;
const LIVE_2 = `LIVE-CLAUSE-TWO-${tag} — شرط الضمان`;
const LIVE_3 = `LIVE-CLAUSE-THREE-${tag} — شرط التحكيم`;
const PROPOSED_SENTINEL = `PROPOSED-CLAUSE-${tag}`;
const INTERNAL_SENTINEL = `INTERNAL-NOTE-${tag}`;
const VISIBLE_COMMENT = `VISIBLE-COMMENT-${tag}`;
const RISK_SENTINEL = `RISK-FINDING-${tag}`;
const OBLIGATION_SENTINEL = `OBLIGATION-${tag}`;

describeReal('⭐ Feature #8d — POST /guest/contracts/:id/import (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let contracts: ContractsService;
  let importService: GuestImportService;

  // ─── Fixture ids ─────────────────────────────────────────────────────────
  const orgAId = randomUUID(); // the IMPORTER's org
  const orgBId = randomUUID(); // the HOST (sharing) org — owns the source

  const hostOwnerId = randomUUID(); // org B — granter / source creator
  const userMId = randomUUID(); // MANAGING, org A — BOUND (the importer)
  const userUId = randomUUID(); // MANAGING, org A — UNBOUND
  const userGId = randomUUID(); // GUEST, no org — BOUND
  const userRId = randomUUID(); // MANAGING, org A — bound then REVOKED

  const projectAId = randomUUID(); // org A — the legit destination
  const projectBId = randomUUID(); // org B — the WRONG destination

  const sourceContractId = randomUUID(); // org B — the shared source
  const sourceDocId = randomUUID(); // org B — source upload doc

  const liveClauseIds: string[] = [];
  const liveCcIds: string[] = [];

  let injectedUser: any;

  const MANAGING_M = () => ({
    id: userMId,
    role: 'OWNER_ADMIN',
    organization_id: orgAId,
    account_type: 'MANAGING',
  });
  const MANAGING_U = () => ({
    id: userUId,
    role: 'OWNER_ADMIN',
    organization_id: orgAId,
    account_type: 'MANAGING',
  });
  const GUEST_G = () => ({
    id: userGId,
    role: 'GUEST',
    organization_id: null,
    account_type: 'GUEST',
  });
  const MANAGING_R = () => ({
    id: userRId,
    role: 'OWNER_ADMIN',
    organization_id: orgAId,
    account_type: 'MANAGING',
  });

  const insertUser = (
    id: string,
    role: string,
    accountType: string,
    org: string | null,
  ) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,'$2a$10$guestimport.hash.sentinel.not.real.hash',
                 'Import','Test',$3,$4,$5,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `import-${id.slice(0, 8)}@test.local`, role, accountType, org],
    );

  /** Seed a clause + junction on the SOURCE contract. */
  const seedSourceClause = async (
    title: string,
    content: string,
    section: string | null,
    order: number,
    isProposed: boolean,
    customizations: Record<string, unknown> | null = null,
  ) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, clause_type,
                            source, review_status, source_document_id, version,
                            is_active, confidence_score, created_by)
       VALUES ($1,$2,$3,$4,'payment_terms','AI_EXTRACTED',
               $5,$6,1,TRUE,0.91,$7)`,
      [
        clauseId,
        orgBId,
        title,
        content,
        isProposed ? 'PENDING_REVIEW' : 'APPROVED',
        isProposed ? sourceDocId : null,
        hostOwnerId,
      ],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number,
                                     order_index, is_proposed, customizations)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        ccId,
        sourceContractId,
        clauseId,
        section,
        order,
        isProposed,
        customizations ? JSON.stringify(customizations) : null,
      ],
    );
    if (!isProposed) {
      liveClauseIds.push(clauseId);
      liveCcIds.push(ccId);
    }
    return { clauseId, ccId };
  };

  const insertBinding = async (userId: string) => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [id, userId, sourceContractId, hostOwnerId],
    );
    return id;
  };

  // ─── State probes ────────────────────────────────────────────────────────

  /** Full serialized state of the SOURCE side — for byte-compare. */
  const sourceState = async () => {
    const contract = await dataSource.query(
      `SELECT row_to_json(c) FROM contracts c WHERE c.id = $1`,
      [sourceContractId],
    );
    const clauses = await dataSource.query(
      `SELECT row_to_json(x) FROM (
         SELECT cc.*, c.title, c.content, c.review_status, c.is_active,
                c.organization_id
           FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
          WHERE cc.contract_id = $1
          ORDER BY cc.is_proposed, cc.order_index, cc.id
       ) x`,
      [sourceContractId],
    );
    const versions = await dataSource.query(
      `SELECT count(*)::int n FROM contract_versions WHERE contract_id = $1`,
      [sourceContractId],
    );
    return JSON.stringify({ contract, clauses, versions });
  };

  const contractsInOrgA = async (): Promise<any[]> =>
    dataSource.query(
      `SELECT ct.* FROM contracts ct
         JOIN projects p ON p.id = ct.project_id
        WHERE p.organization_id = $1
        ORDER BY ct.created_at ASC`,
      [orgAId],
    );

  const clausesInOrgA = async (): Promise<any[]> =>
    dataSource.query(
      `SELECT * FROM clauses WHERE organization_id = $1 ORDER BY created_at ASC`,
      [orgAId],
    );

  const copiedClauseRows = async (newContractId: string): Promise<any[]> =>
    dataSource.query(
      `SELECT cc.section_number, cc.order_index, cc.is_proposed,
              cc.customizations, cc.clause_id,
              c.title, c.content, c.clause_type, c.organization_id,
              c.source_document_id, c.review_status, c.source, c.created_by,
              c.confidence_score
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE cc.contract_id = $1
        ORDER BY cc.order_index ASC`,
      [newContractId],
    );

  const importAs = (principal: any, contractId: string, body: any) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .post(`/guest/contracts/${contractId}/import`)
      .set('Authorization', 'Bearer test-jwt')
      .send(body);
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
      ],
      controllers: [GuestImportController],
      providers: [
        {
          provide: GuestImportService,
          useFactory: (ds: DataSource) => {
            const access = new ContractAccessService(
              ds.getRepository(Contract),
              ds.getRepository(GuestContractAccess),
            );
            // Manual ContractsService construction — the apply-proposed-version
            // precedent: real repos for the exercised paths
            // (createVersionSnapshot), `{} as any` for the rest.
            contracts = new ContractsService(
              ds.getRepository(Contract),
              ds.getRepository(ContractClause),
              ds.getRepository(ContractVersion),
              {} as any,
              {} as any,
              {} as any,
              ds.getRepository(User),
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              access,
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              ds.getRepository(Clause),
              {} as any, // relationshipTypes (T0a) — not exercised by import
              {} as any, // 20 negotiationStatus (7.19 S2) — share hook not exercised here
            );
            importService = new GuestImportService(
              ds,
              access,
              contracts,
              ds.getRepository(Project),
            );
            return importService;
          },
          inject: [DataSource],
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
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = moduleRef.get(DataSource);

    // ── Orgs / users / projects ──
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1,$2), ($3,$4)`,
      [orgAId, `importer-org-${tag}`, orgBId, `Sharing Host Org ${tag}`],
    );
    await insertUser(hostOwnerId, 'OWNER_ADMIN', 'MANAGING', orgBId);
    await insertUser(userMId, 'OWNER_ADMIN', 'MANAGING', orgAId);
    await insertUser(userUId, 'OWNER_ADMIN', 'MANAGING', orgAId);
    await insertUser(userGId, 'GUEST', 'GUEST', null);
    await insertUser(userRId, 'OWNER_ADMIN', 'MANAGING', orgAId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1,$2,'importer-project',$3), ($4,$5,'host-project',$6)`,
      [projectAId, orgAId, userMId, projectBId, orgBId, hostOwnerId],
    );

    // ── The SOURCE contract (org B): ACTIVE + FULLY_EXECUTED + pin-marked,
    //    party names + value — proves the copy resets workflow state. ──
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, status,
                              current_version, creation_flow, created_by,
                              signature_status, party_first_name,
                              party_second_name, contract_value, currency,
                              pinned_at, pinned_content_hash,
                              notice_period_days)
       VALUES ($1,$2,$3,'UPLOADED','ACTIVE',3,'UPLOAD',$4,
               'FULLY_EXECUTED','الهيئة القومية للأنفاق','شركة المقاولون العرب',
               1500000.00,'EGP', NOW(), repeat('a', 64), 28)`,
      [sourceContractId, projectBId, `عقد أعمال الحفر ${tag}`, hostOwnerId],
    );
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url,
                                     file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'CLAUSES_EXTRACTED',$6)`,
      [
        sourceDocId,
        sourceContractId,
        orgBId,
        `http://x/${sourceDocId}.pdf`,
        `${sourceDocId}.pdf`,
        hostOwnerId,
      ],
    );

    // ── Live clauses (the guest-visible content) + one PROPOSED clause ──
    await seedSourceClause(`البند الأول ${tag}`, LIVE_1, '1', 0, false, {
      highlighted: true,
    });
    await seedSourceClause(`البند الثاني ${tag}`, LIVE_2, '2', 1, false);
    await seedSourceClause(`البند الثالث ${tag}`, LIVE_3, '3-1', 2, false);
    await seedSourceClause(
      `مقترح ${tag}`,
      PROPOSED_SENTINEL,
      '9',
      0,
      true, // is_proposed — must NEVER be copied
    );

    // ── Host-only data the guest-scoped read must never surface ──
    await dataSource.query(
      `INSERT INTO contract_comments
         (id, contract_id, contract_clause_id, user_id, content,
          is_resolved, is_internal_note, parent_comment_id)
       VALUES ($1,$2,NULL,$3,$4,FALSE,TRUE,NULL),
              ($5,$6,NULL,$7,$8,FALSE,FALSE,NULL)`,
      [
        randomUUID(),
        sourceContractId,
        hostOwnerId,
        INTERNAL_SENTINEL,
        randomUUID(),
        sourceContractId,
        hostOwnerId,
        VISIBLE_COMMENT,
      ],
    );
    await dataSource.query(
      `INSERT INTO risk_analyses (id, contract_id, risk_category, risk_level, description)
       VALUES ($1,$2,'Payment Terms','HIGH',$3)`,
      [randomUUID(), sourceContractId, RISK_SENTINEL],
    );
    await dataSource.query(
      `INSERT INTO obligations (id, contract_id, description, status,
                                reminder_days_before, is_critical, reminder_schedule)
       VALUES ($1,$2,$3,'PENDING',7,FALSE,'{30,14,7,1}')`,
      [randomUUID(), sourceContractId, OBLIGATION_SENTINEL],
    );

    // ── Bindings: M and G bound; U unbound; R bound (revoked in its test) ──
    await insertBinding(userMId);
    await insertBinding(userGId);
    await insertBinding(userRId);
  });

  afterAll(async () => {
    // Fixture teardown — children first. Copied rows live in org A projects;
    // source rows in org B. Everything is keyed off the two fixture orgs.
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM contract_versions WHERE contract_id IN (
           SELECT ct.id FROM contracts ct JOIN projects p ON p.id = ct.project_id
            WHERE p.organization_id IN ($1, $2))`,
        [orgAId, orgBId],
      );
      await dataSource.query(
        `DELETE FROM contract_comments WHERE contract_id IN (
           SELECT ct.id FROM contracts ct JOIN projects p ON p.id = ct.project_id
            WHERE p.organization_id IN ($1, $2))`,
        [orgAId, orgBId],
      );
      await dataSource.query(
        `DELETE FROM risk_analyses WHERE contract_id IN (
           SELECT ct.id FROM contracts ct JOIN projects p ON p.id = ct.project_id
            WHERE p.organization_id IN ($1, $2))`,
        [orgAId, orgBId],
      );
      await dataSource.query(
        `DELETE FROM obligations WHERE contract_id IN (
           SELECT ct.id FROM contracts ct JOIN projects p ON p.id = ct.project_id
            WHERE p.organization_id IN ($1, $2))`,
        [orgAId, orgBId],
      );
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE contract_id = $1`,
        [sourceContractId],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id IN (
           SELECT ct.id FROM contracts ct JOIN projects p ON p.id = ct.project_id
            WHERE p.organization_id IN ($1, $2))`,
        [orgAId, orgBId],
      );
      await dataSource.query(`DELETE FROM clauses WHERE organization_id IN ($1, $2)`, [
        orgAId,
        orgBId,
      ]);
      await dataSource.query(`DELETE FROM document_uploads WHERE id = $1`, [
        sourceDocId,
      ]);
      await dataSource.query(
        `DELETE FROM contracts WHERE project_id IN ($1, $2)`,
        [projectAId, projectBId],
      );
      await dataSource.query(`DELETE FROM projects WHERE id IN ($1, $2)`, [
        projectAId,
        projectBId,
      ]);
      await dataSource.query(
        `DELETE FROM users WHERE id IN ($1,$2,$3,$4,$5)`,
        [hostOwnerId, userMId, userUId, userGId, userRId],
      );
      await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
        orgAId,
        orgBId,
      ]);
    }
    await app?.close();
  });

  // ───────────────────────────────────────────────────────────────────────────

  it('⭐ 1. CORRECT COPY — bound managing user imports into their own project', async () => {
    const before = await sourceState();

    const res = await importAs(MANAGING_M(), sourceContractId, {
      destinationProjectId: projectAId,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.project_id).toBe(projectAId);
    expect(res.body.name).toContain('عقد أعمال الحفر');

    const newId = res.body.id;
    expect(newId).not.toBe(sourceContractId);

    // The new contract row — importer's org, fresh workflow state.
    const [copy] = await dataSource.query(
      `SELECT * FROM contracts WHERE id = $1`,
      [newId],
    );
    expect(copy).toBeDefined();
    expect(copy.project_id).toBe(projectAId);
    expect(copy.name).toBe(`عقد أعمال الحفر ${tag}`);
    expect(copy.contract_type).toBe('UPLOADED');
    expect(copy.status).toBe('DRAFT'); // NOT the source's ACTIVE
    expect(copy.current_version).toBe(1); // NOT the source's 3
    expect(copy.creation_flow).toBe('IMPORT');
    expect(copy.created_by).toBe(userMId);
    expect(copy.signature_status).toBeNull(); // NOT FULLY_EXECUTED
    expect(copy.docusign_envelope_id).toBeNull();
    expect(copy.pinned_version_id).toBeNull(); // NOT pinned
    expect(copy.pinned_at).toBeNull();
    expect(copy.pinned_content_hash).toBeNull();
    expect(copy.approved_by).toBeNull();
    expect(copy.executed_at).toBeNull();
    expect(copy.relationship_type).toBeNull();
    expect(copy.parent_contract_id).toBeNull();
    expect(copy.license_acknowledged).toBe(false);
    // Content scalars copied.
    expect(copy.party_first_name).toBe('الهيئة القومية للأنفاق');
    expect(copy.party_second_name).toBe('شركة المقاولون العرب');
    expect(Number(copy.contract_value)).toBe(1500000);
    expect(copy.currency).toBe('EGP');
    expect(copy.notice_period_days).toBe(28);

    // Clause set — row-identical CONTENT, fresh rows in org A.
    const copied = await copiedClauseRows(newId);
    expect(copied).toHaveLength(3); // the 3 LIVE clauses — proposed NOT copied
    expect(copied.map((c: any) => c.content)).toEqual([LIVE_1, LIVE_2, LIVE_3]);
    expect(copied.map((c: any) => c.section_number)).toEqual(['1', '2', '3-1']);
    expect(copied.map((c: any) => c.order_index)).toEqual([0, 1, 2]);
    expect(copied[0].customizations).toEqual({ highlighted: true });
    for (const row of copied) {
      expect(row.organization_id).toBe(orgAId); // fresh Clause rows in org A
      expect(liveClauseIds).not.toContain(row.clause_id); // never source ids
      expect(row.source_document_id).toBeNull(); // source doc NOT referenced
      expect(row.is_proposed).toBe(false);
      expect(row.review_status).toBe('APPROVED');
      expect(row.source).toBe('AI_EXTRACTED');
      expect(row.created_by).toBe(userMId);
      expect(Number(row.confidence_score)).toBeCloseTo(0.91);
    }

    // A REAL V1 snapshot (CREATED) exists for the copy, holding the 3 clauses.
    const versions = await dataSource.query(
      `SELECT version_number, event_type, clause_snapshot
         FROM contract_versions WHERE contract_id = $1`,
      [newId],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].event_type).toBe('CREATED');
    expect(versions[0].clause_snapshot.clauses).toHaveLength(3);

    // ⭐ 2. THE SOURCE IS UNTOUCHED — byte-identical before/after.
    expect(await sourceState()).toBe(before);
  });

  it('⭐ 3. GUEST-SCOPED SOURCE — no internal notes / risk / obligations / proposed clauses in the copy', async () => {
    // Runs against the copy created in test 1.
    const [copy] = await contractsInOrgA();
    expect(copy).toBeDefined();

    const commentCount = await dataSource.query(
      `SELECT count(*)::int n FROM contract_comments WHERE contract_id = $1`,
      [copy.id],
    );
    const riskCount = await dataSource.query(
      `SELECT count(*)::int n FROM risk_analyses WHERE contract_id = $1`,
      [copy.id],
    );
    const obligationCount = await dataSource.query(
      `SELECT count(*)::int n FROM obligations WHERE contract_id = $1`,
      [copy.id],
    );
    expect(commentCount[0].n).toBe(0); // no comments — internal OR visible
    expect(riskCount[0].n).toBe(0); // no source risk findings
    expect(obligationCount[0].n).toBe(0); // no source obligations

    // No sentinel leaks anywhere in the copied clause content, and no
    // proposed junction was created.
    const copied = await copiedClauseRows(copy.id);
    const serialized = JSON.stringify(copied);
    expect(serialized).not.toContain(PROPOSED_SENTINEL);
    expect(serialized).not.toContain(INTERNAL_SENTINEL);
    expect(serialized).not.toContain(RISK_SENTINEL);
    expect(serialized).not.toContain(OBLIGATION_SENTINEL);
    const proposedInCopy = await dataSource.query(
      `SELECT count(*)::int n FROM contract_clauses
        WHERE contract_id = $1 AND is_proposed = true`,
      [copy.id],
    );
    expect(proposedInCopy[0].n).toBe(0);
  });

  it('⭐ 4. ATOMICITY — a failure mid-copy rolls back EVERYTHING', async () => {
    const contractsBefore = (await contractsInOrgA()).length;
    const clausesBefore = (await clausesInOrgA()).length;
    const sourceBefore = await sourceState();

    // The snapshot is the LAST step inside the transaction — making it throw
    // proves the contract + every clause + every junction roll back with it.
    const spy = jest
      .spyOn(contracts, 'createVersionSnapshot')
      .mockRejectedValueOnce(new Error('boom — forced mid-copy failure'));

    const res = await importAs(MANAGING_M(), sourceContractId, {
      destinationProjectId: projectAId,
    });
    expect(res.status).toBe(500);
    spy.mockRestore();

    // FULL rollback — no orphan contract, no partial clauses, source intact.
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
    expect((await clausesInOrgA()).length).toBe(clausesBefore);
    expect(await sourceState()).toBe(sourceBefore);
  });

  it('⭐ 5. DESTINATION OWNERSHIP — another org\'s project (the sharing org\'s own) → 404, no copy', async () => {
    const contractsBefore = (await contractsInOrgA()).length;
    const res = await importAs(MANAGING_M(), sourceContractId, {
      destinationProjectId: projectBId, // org B's project — NOT the caller's
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Project not found');
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
    // No stray contract landed in org B's project either.
    const inB = await dataSource.query(
      `SELECT count(*)::int n FROM contracts WHERE project_id = $1`,
      [projectBId],
    );
    expect(inB[0].n).toBe(1); // only the source itself
  });

  it('⭐ 6a. BINDING WALL — an unbound managing user → uniform 404, no copy', async () => {
    const contractsBefore = (await contractsInOrgA()).length;
    const res = await importAs(MANAGING_U(), sourceContractId, {
      destinationProjectId: projectAId,
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contract not found'); // uniform — no oracle
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
  });

  it('⭐ 6b. BINDING WALL — a bound GUEST account (no org) → 404, no copy (nothing to import into)', async () => {
    const contractsBefore = (await contractsInOrgA()).length;
    const clausesBefore = (await clausesInOrgA()).length;
    const res = await importAs(GUEST_G(), sourceContractId, {
      destinationProjectId: projectAId, // org A's project — NOT the guest's
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Project not found');
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
    expect((await clausesInOrgA()).length).toBe(clausesBefore);
  });

  it('⭐ 7. REVOKED — binding deleted, then import → 404, no partial copy', async () => {
    // R was bound at seed time; the share is revoked before the click lands.
    await dataSource.query(
      `DELETE FROM guest_contract_access WHERE user_id = $1 AND contract_id = $2`,
      [userRId, sourceContractId],
    );
    const contractsBefore = (await contractsInOrgA()).length;
    const res = await importAs(MANAGING_R(), sourceContractId, {
      destinationProjectId: projectAId,
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contract not found');
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
  });

  it('DTO validation — a non-UUID destinationProjectId → 400, no copy', async () => {
    const contractsBefore = (await contractsInOrgA()).length;
    const res = await importAs(MANAGING_M(), sourceContractId, {
      destinationProjectId: 'not-a-uuid',
    });
    expect(res.status).toBe(400);
    expect((await contractsInOrgA()).length).toBe(contractsBefore);
  });

  it('unauthenticated → 401', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${sourceContractId}/import`)
      .send({ destinationProjectId: projectAId });
    expect(res.status).toBe(401);
  });
});
