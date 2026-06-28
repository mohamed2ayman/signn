import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
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

/**
 * Guest version review — Sub-slice 2a, PART B (the APPLY operation).
 *
 * applyProposedVersion commits a host's per-clause decisions on a guest-proposed
 * version, ATOMICALLY, with snapshot-before-promote + parent-chain lineage.
 * Proven against real Postgres (the parent-chain + atomicity + snapshot content
 * are SQL-level guarantees — lesson #140: a mocked DB hides exactly these).
 *
 * RED→GREEN: before applyProposedVersion existed this spec could not resolve the
 * method. GREEN below proves: the happy-path mix (accept/edit/add/remove/reject),
 * snapshot-before (snapshot holds the ORIGINAL wording → it ran first),
 * ATOMICITY (mid-apply failure rolls back the snapshot AND promotions), the
 * rejected-only no-op, the org-scope auth wall (cross-org → 404), and
 * parent-chain integrity.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[apply-proposed-version] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the apply is atomic, snapshots ' +
      'before promoting, and links the parent-chain. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('applyProposedVersion — Part B (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contracts: ContractsService;
  let contractAccess: ContractAccessService;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();
  const docId = randomUUID();

  const insertUser = (id: string, org: string | null) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Apply','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `apply-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.apply.test', org],
    );

  // Seed a LIVE clause (is_proposed=false) at a given order; returns ids.
  const seedLive = async (title: string, content: string, order: number) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',1,TRUE,$5)`,
      [clauseId, orgId, title, content, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,false)`,
      [ccId, contractId, clauseId, order],
    );
    return { clauseId, ccId };
  };

  // Seed a PROPOSED clause (is_proposed=true, scoped by source_document_id).
  const seedProposed = async (title: string, content: string, order: number) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, source_document_id, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','PENDING_REVIEW',$5,1,TRUE,$6)`,
      [clauseId, orgId, title, content, docId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,true)`,
      [ccId, contractId, clauseId, order],
    );
    return { clauseId, ccId };
  };

  const liveClauses = () =>
    dataSource.query(
      `SELECT cc.id cc_id, cc.clause_id, cc.order_index, c.title, c.content, c.review_status, c.parent_clause_id, c.is_active
         FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
        WHERE cc.contract_id = $1 AND cc.is_proposed = false
        ORDER BY cc.order_index ASC`,
      [contractId],
    );
  const versionCount = async () =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM contract_versions WHERE contract_id = $1`,
          [contractId],
        )
      )[0].n,
    );
  const clauseActive = async (id: string) =>
    (await dataSource.query(`SELECT is_active FROM clauses WHERE id = $1`, [id]))[0]?.is_active;
  const ccExists = async (id: string) =>
    Number(
      (await dataSource.query(`SELECT count(*)::int n FROM contract_clauses WHERE id = $1`, [id]))[0].n,
    ) > 0;

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
    contracts = new ContractsService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(ContractVersion),
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(User),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      contractAccess,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(Clause),
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `apply-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      otherOrgId,
      `apply-other-org-${otherOrgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerId, orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'apply-project',$3)`,
      [projectId, orgId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'Apply Contract','FIDIC_RED_BOOK',$3)`,
      [contractId, projectId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'CLAUSES_EXTRACTED',$6)`,
      [docId, contractId, orgId, `http://x/${docId}.pdf`, `${docId}.pdf`, ownerId],
    );
  });

  // Each test mutates the clause set → wipe + reseed per test.
  beforeEach(async () => {
    await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [orgId]);
    await dataSource.query(`UPDATE contracts SET current_version = 0 WHERE id = $1`, [contractId]);
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
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    }
    await moduleRef?.close();
  });

  it('⭐ GREEN — happy-path mix (2 accept, 1 edit, 1 add, 1 remove-accept, 2 reject) applies ONLY the accepted changes; rejected leave originals intact', async () => {
    const La = await seedLive('Live A', 'live content a', 0);
    const Lb = await seedLive('Live B', 'live content b', 1);
    const Lc = await seedLive('Live C', 'live content c', 2);
    const Ld = await seedLive('Live D', 'live content d', 3);
    const Le = await seedLive('Live E', 'live content e', 4);
    const Pacc1 = await seedProposed('Prop Acc1', 'proposed acc1', 0);
    const Pacc2 = await seedProposed('Prop Acc2', 'proposed acc2', 1);
    const Pedit = await seedProposed('Prop Edit', 'proposed edit raw', 2);
    const Padd = await seedProposed('Prop Add', 'proposed add', 3);
    const Prej1 = await seedProposed('Prop Rej1', 'proposed rej1', 4);
    const Prej2 = await seedProposed('Prop Rej2', 'proposed rej2', 5);

    const result = await contracts.applyProposedVersion(
      contractId,
      docId,
      {
        decisions: [
          { proposed_contract_clause_id: Pacc1.ccId, action: 'accept', replaces_contract_clause_id: La.ccId },
          { proposed_contract_clause_id: Pacc2.ccId, action: 'accept', replaces_contract_clause_id: Lb.ccId },
          {
            proposed_contract_clause_id: Pedit.ccId,
            action: 'edit',
            replaces_contract_clause_id: Lc.ccId,
            edited_title: 'Merged C',
            edited_content: 'host merged content c',
          },
          { proposed_contract_clause_id: Padd.ccId, action: 'accept' },
          { proposed_contract_clause_id: Prej1.ccId, action: 'reject' },
          { proposed_contract_clause_id: Prej2.ccId, action: 'reject' },
        ],
        removals: [{ contract_clause_id: Ld.ccId, action: 'accept' }],
        change_summary: 'apply guest version',
      },
      ownerId,
      orgId,
    );

    expect(result).toMatchObject({ accepted: 2, edited: 1, added: 1, removed: 1, rejected: 2 });
    expect(result.snapshot_version_id).not.toBeNull();

    const live = await liveClauses();
    // La,Lb,Lc(merged),Le,Padd = 5 live; Ld removed.
    expect(live).toHaveLength(5);
    const byCc = new Map<string, any>(live.map((r: any) => [r.cc_id, r]));

    // accept-modify: original junction repointed to the proposed clause's content.
    expect(byCc.get(La.ccId).content).toBe('proposed acc1');
    expect(byCc.get(La.ccId).clause_id).toBe(Pacc1.clauseId);
    expect(byCc.get(La.ccId).review_status).toBe('APPROVED');
    expect(byCc.get(Lb.ccId).content).toBe('proposed acc2');

    // edit-merge: host wording + EDITED.
    expect(byCc.get(Lc.ccId).title).toBe('Merged C');
    expect(byCc.get(Lc.ccId).content).toBe('host merged content c');
    expect(byCc.get(Lc.ccId).review_status).toBe('EDITED');

    // add: new live clause appended past the live tail (max was 4 → 5).
    expect(byCc.has(Padd.ccId)).toBe(true);
    expect(Number(byCc.get(Padd.ccId).order_index)).toBe(5);

    // remove-accept: Ld gone from live, original retired.
    expect(await ccExists(Ld.ccId)).toBe(false);
    expect(await clauseActive(Ld.clauseId)).toBe(false);

    // untouched original survives.
    expect(byCc.get(Le.ccId).content).toBe('live content e');

    // reject: proposed rows discarded, no live presence.
    expect(await ccExists(Prej1.ccId)).toBe(false);
    expect(await ccExists(Prej2.ccId)).toBe(false);

    // parent-chain lineage on a promoted clause + original retired.
    const lineage = await dataSource.query(
      `SELECT parent_clause_id, is_active FROM clauses WHERE id = $1`,
      [Pacc1.clauseId],
    );
    expect(lineage[0].parent_clause_id).toBe(La.clauseId);
    expect(await clauseActive(La.clauseId)).toBe(false);

    // proposed pile for the doc is fully consumed.
    const remainingProposed = await dataSource.query(
      `SELECT count(*)::int n FROM contract_clauses WHERE contract_id = $1 AND is_proposed = true`,
      [contractId],
    );
    expect(Number(remainingProposed[0].n)).toBe(0);
  });

  it('⭐ GREEN — snapshot-before: the snapshot captures the ORIGINAL wording (it ran first), while the live clause now carries the proposed wording', async () => {
    const La = await seedLive('Live A', 'ORIGINAL content a', 0);
    const Pacc = await seedProposed('Prop A', 'PROPOSED content a', 0);

    const result = await contracts.applyProposedVersion(
      contractId,
      docId,
      { decisions: [{ proposed_contract_clause_id: Pacc.ccId, action: 'accept', replaces_contract_clause_id: La.ccId }] },
      ownerId,
      orgId,
    );

    // Snapshot holds the PRE-apply (original) content.
    const snap = await dataSource.query(
      `SELECT clause_snapshot FROM contract_versions WHERE id = $1`,
      [result.snapshot_version_id],
    );
    const snapClauses = snap[0].clause_snapshot.clauses;
    expect(snapClauses).toHaveLength(1);
    expect(snapClauses[0].clause_content).toBe('ORIGINAL content a');
    expect(snapClauses[0].clause_content).not.toBe('PROPOSED content a');

    // Live clause now carries the proposed wording (mutation happened after).
    const live = await liveClauses();
    expect(live).toHaveLength(1);
    expect(live[0].content).toBe('PROPOSED content a');
  });

  it('⭐ GREEN — ATOMICITY: a mid-apply failure rolls back the snapshot AND all promotions (nothing persists)', async () => {
    const La = await seedLive('Live A', 'live content a', 0);
    const Pgood = await seedProposed('Prop Good', 'proposed good', 0);
    const Pbad = await seedProposed('Prop Bad', 'proposed bad', 1);

    const versionsBefore = await versionCount();

    await expect(
      contracts.applyProposedVersion(
        contractId,
        docId,
        {
          decisions: [
            // first valid promotion (snapshot taken, La repointed)…
            { proposed_contract_clause_id: Pgood.ccId, action: 'accept', replaces_contract_clause_id: La.ccId },
            // …then a bogus replaces id → throws mid-transaction.
            { proposed_contract_clause_id: Pbad.ccId, action: 'accept', replaces_contract_clause_id: randomUUID() },
          ],
        },
        ownerId,
        orgId,
      ),
    ).rejects.toBeTruthy();

    // Snapshot rolled back — no new version row.
    expect(await versionCount()).toBe(versionsBefore);
    // Promotion rolled back — original still active, junction still points to it.
    expect(await clauseActive(La.clauseId)).toBe(true);
    const live = await liveClauses();
    expect(live).toHaveLength(1);
    expect(live[0].clause_id).toBe(La.clauseId);
    expect(live[0].content).toBe('live content a');
    // Proposed pile untouched (nothing consumed).
    expect(await ccExists(Pgood.ccId)).toBe(true);
    expect(await ccExists(Pbad.ccId)).toBe(true);
  });

  it('GREEN — rejected-only apply is a NO-OP on the contract: no snapshot, originals intact, proposed discarded', async () => {
    const La = await seedLive('Live A', 'live content a', 0);
    const Prej = await seedProposed('Prop R', 'proposed r', 0);

    const versionsBefore = await versionCount();
    const result = await contracts.applyProposedVersion(
      contractId,
      docId,
      { decisions: [{ proposed_contract_clause_id: Prej.ccId, action: 'reject' }] },
      ownerId,
      orgId,
    );

    expect(result).toMatchObject({ accepted: 0, edited: 0, added: 0, removed: 0, rejected: 1 });
    expect(result.snapshot_version_id).toBeNull();
    // No snapshot / version bump for a pure no-op.
    expect(await versionCount()).toBe(versionsBefore);
    // Original untouched.
    const live = await liveClauses();
    expect(live).toHaveLength(1);
    expect(live[0].clause_id).toBe(La.clauseId);
    expect(live[0].content).toBe('live content a');
    // Proposed discarded.
    expect(await ccExists(Prej.ccId)).toBe(false);
  });

  it('GREEN — AUTH: a non-owning org cannot apply (cross-org → 404, no mutation)', async () => {
    const La = await seedLive('Live A', 'live content a', 0);
    const Pacc = await seedProposed('Prop A', 'proposed a', 0);

    await expect(
      contracts.applyProposedVersion(
        contractId,
        docId,
        { decisions: [{ proposed_contract_clause_id: Pacc.ccId, action: 'accept', replaces_contract_clause_id: La.ccId }] },
        ownerId,
        otherOrgId, // wrong org
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Nothing changed.
    expect(await clauseActive(La.clauseId)).toBe(true);
    expect(await ccExists(Pacc.ccId)).toBe(true);
    expect(await versionCount()).toBe(0);
  });

  it('GREEN — parent-chain integrity: getContractClauses returns the NEW clause (not the retired original) after accept-modify', async () => {
    const La = await seedLive('Live A', 'live content a', 0);
    const Pacc = await seedProposed('Prop A', 'proposed a', 0);

    await contracts.applyProposedVersion(
      contractId,
      docId,
      { decisions: [{ proposed_contract_clause_id: Pacc.ccId, action: 'accept', replaces_contract_clause_id: La.ccId }] },
      ownerId,
      orgId,
    );

    const hostView = await contracts.getContractClauses(contractId, orgId);
    expect(hostView).toHaveLength(1);
    expect(hostView[0].clause_id).toBe(Pacc.clauseId); // new version
    expect(hostView[0].clause?.content).toBe('proposed a');
    expect(hostView[0].clause?.parent_clause_id).toBe(La.clauseId); // lineage
    expect(hostView[0].is_proposed).toBe(false);
  });
});
