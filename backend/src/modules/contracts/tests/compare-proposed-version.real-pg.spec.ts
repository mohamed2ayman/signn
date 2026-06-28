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
 * Guest version review — Sub-slice 2b (proposed-vs-current compare), real PG.
 *
 * compareProposedVersion diffs a guest's PROPOSED set (is_proposed=true, scoped
 * by source_document_id) against the contract's CURRENT live clauses, matched by
 * section_number, reusing the extracted computeClauseDiff. GREEN: a mix of
 * modified / added / removed surfaces correctly with word-level diff on
 * modified; cross-org → 404; empty/all-identical → sensible empty diff.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[compare-proposed-version] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the proposed-vs-current diff over real rows.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('compareProposedVersion — Part B 2b (real Postgres)', () => {
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
       ) VALUES ($1,$2,$3,'Cmp','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `cmp-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.cmp.test', org],
    );

  const seedLive = async (title: string, content: string, order: number, section: string | null) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',1,TRUE,$5)`,
      [clauseId, orgId, title, content, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,false)`,
      [ccId, contractId, clauseId, section, order],
    );
    return { clauseId, ccId };
  };

  const seedProposed = async (title: string, content: string, order: number, section: string | null) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, source_document_id, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','PENDING_REVIEW',$5,1,TRUE,$6)`,
      [clauseId, orgId, title, content, docId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [ccId, contractId, clauseId, section, order],
    );
    return { clauseId, ccId };
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

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [orgId, `cmp-org-${orgId.slice(0, 8)}`]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [otherOrgId, `cmp-other-${otherOrgId.slice(0, 8)}`]);
    await insertUser(ownerId, orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'cmp-project',$3)`,
      [projectId, orgId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'Cmp Contract','FIDIC_RED_BOOK',$3)`,
      [contractId, projectId, ownerId],
    );
    await dataSource.query(
      `INSERT INTO document_uploads (id, contract_id, organization_id, file_url, file_name, processing_status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'CLAUSES_EXTRACTED',$6)`,
      [docId, contractId, orgId, `http://x/${docId}.pdf`, `${docId}.pdf`, ownerId],
    );
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [orgId]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
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

  it('⭐ GREEN — modified/added/removed surface correctly with word-level diff on modified', async () => {
    // Current live: §1 (will be modified), §2 (will be removed — no proposed match).
    await seedLive('Payment', 'pay within 30 days of invoice', 0, '1');
    await seedLive('Old Clause', 'this clause is dropped', 1, '2');
    // Proposed: §1 (modified content), §3 (added — no current match).
    await seedProposed('Payment', 'pay within 45 days of invoice', 0, '1');
    await seedProposed('Force Majeure', 'new force majeure clause', 1, '3');

    const result = await contracts.compareProposedVersion(contractId, docId, orgId);

    expect(result.contract_id).toBe(contractId);
    expect(result.document_id).toBe(docId);
    expect(result.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 0 });

    const modified = result.changes.find((c) => c.changeType === 'MODIFIED')!;
    expect(modified.clauseNumber).toBe('1');
    expect(modified.originalText).toBe('pay within 30 days of invoice');
    expect(modified.newText).toBe('pay within 45 days of invoice');
    // Word-level: 45 added, 30 removed.
    expect(modified.wordLevelDiff!.some((p) => p.added && p.value.includes('45'))).toBe(true);
    expect(modified.wordLevelDiff!.some((p) => p.removed && p.value.includes('30'))).toBe(true);

    const added = result.changes.find((c) => c.changeType === 'ADDED')!;
    expect(added.clauseNumber).toBe('3');
    expect(added.originalText).toBeNull();
    expect(added.newText).toBe('new force majeure clause');

    const removed = result.changes.find((c) => c.changeType === 'REMOVED')!;
    expect(removed.clauseNumber).toBe('2');
    expect(removed.newText).toBeNull();
    expect(removed.originalText).toBe('this clause is dropped');

    // Changed clauses sort before any unchanged.
    expect(result.changes.map((c) => c.changeType)).not.toContain('UNCHANGED');
  });

  it('GREEN — Arabic clause content diffs at the word level (content is opaque to the algorithm)', async () => {
    await seedLive('بند الدفع', 'يُدفع خلال ثلاثين يوماً', 0, '1');
    await seedProposed('بند الدفع', 'يُدفع خلال خمسة وأربعين يوماً', 0, '1');

    const result = await contracts.compareProposedVersion(contractId, docId, orgId);
    expect(result.summary.modified).toBe(1);
    const m = result.changes[0];
    expect(m.changeType).toBe('MODIFIED');
    expect(m.originalText).toContain('ثلاثين');
    expect(m.newText).toContain('خمسة وأربعين');
    expect(m.wordLevelDiff!.length).toBeGreaterThan(0);
  });

  it('GREEN — all-identical proposed set → all UNCHANGED, zero changes flagged', async () => {
    await seedLive('Scope', 'identical scope text', 0, '1');
    await seedProposed('Scope', 'identical scope text', 0, '1');

    const result = await contracts.compareProposedVersion(contractId, docId, orgId);
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 1 - 1, unchanged: 1 });
  });

  it('GREEN — empty proposed set → every current clause shows REMOVED', async () => {
    await seedLive('A', 'a', 0, '1');
    await seedLive('B', 'b', 1, '2');
    const result = await contracts.compareProposedVersion(contractId, docId, orgId);
    expect(result.summary).toEqual({ added: 0, removed: 2, modified: 0, unchanged: 0 });
  });

  it('GREEN — AUTH: cross-org caller → 404 (host action, no leak)', async () => {
    await seedLive('A', 'a', 0, '1');
    await seedProposed('A', 'a2', 0, '1');
    await expect(
      contracts.compareProposedVersion(contractId, docId, otherOrgId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
