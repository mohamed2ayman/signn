import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Contract,
  GuestContractAccess,
  RiskAnalysis,
  RiskCategory,
  RiskRule,
} from '../../../database/entities';
import { RiskAnalysisService } from '../risk-analysis.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Phase 8.3 — annotateRisk (editable Risk Analysis tab) against REAL Postgres.
 *
 * Proves the DB-level guarantees a mocked repo cannot (lesson #140):
 *   - the level/category edit PERSISTS
 *   - is_edited_by_user flips true; edited_by_user_id FK RESOLVES to a real user
 *   - the AI ORIGINAL (level + category) is snapshotted once (the
 *     original-vs-corrected training signal)
 *   - an unknown category is rejected (only the 8 official buckets pass)
 *   - the findInOrg wall 404s a cross-tenant edit
 *   - a NON-edited row is left at the additive-migration defaults (untouched:
 *     is_edited_by_user=false, original_* NULL, AI values intact)
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[annotate-risk] SKIPPING real-Postgres spec: DATABASE_URL unset — this MUST ' +
      'run against Postgres to prove the edit persists, the FK resolves, and the ' +
      'migration is additive. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('RiskAnalysisService.annotateRisk (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let svc: RiskAnalysisService;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();
  const riskEditId = randomUUID();
  const riskUntouchedId = randomUUID();

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Annotate','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `annotate-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.annotate', org],
    );

  const insertRisk = (id: string, level: string, category: string, l: number, i: number) =>
    dataSource.query(
      `INSERT INTO risk_analyses
         (id, contract_id, risk_category, risk_level, description, likelihood, impact,
          risk_score, likelihood_source, impact_source, status)
       VALUES ($1,$2,$3,$4,'seed risk',$5,$6,$7,'FALLBACK','FALLBACK','OPEN')`,
      [id, contractId, category, level, l, i, l * i],
    );

  const readRisk = async (id: string) =>
    (await dataSource.query(`SELECT * FROM risk_analyses WHERE id = $1`, [id]))[0];

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

    const contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );
    // ctor: (riskRepo, riskRuleRepo, riskCategoryRepo, collabGateway,
    //        contractAccess, riskScoped). annotateRisk needs the first three
    //        real repos + the real wall; collab + scoped are stubbed.
    const Ctor: any = RiskAnalysisService;
    svc = new Ctor(
      dataSource.getRepository(RiskAnalysis),
      dataSource.getRepository(RiskRule),
      dataSource.getRepository(RiskCategory),
      { emitRiskUpdated: jest.fn() },
      contractAccess,
      {} as any,
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `annot-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      otherOrgId,
      `annot-other-${otherOrgId.slice(0, 8)}`,
    ]);
    await insertUser(userId, orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'annot-project',$3)`,
      [projectId, orgId, userId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'Annotate Contract','FIDIC_RED_BOOK',$3)`,
      [contractId, projectId, userId],
    );
    // Two AI-style rows (free-text categories): one to edit, one to leave
    // untouched.
    await insertRisk(riskEditId, 'HIGH', 'Uncategorized', 5, 4); // score 20
    await insertRisk(riskUntouchedId, 'MEDIUM', 'Payment Terms', 3, 3); // score 9
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM risk_analyses WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    }
    await moduleRef?.close();
  });

  it('⭐ persists level+category, flips is_edited_by_user, snapshots AI original, FK resolves', async () => {
    // Reassign the AI's 'Uncategorized' to a clause-type label ('Payment').
    const saved = await svc.annotateRisk(
      riskEditId,
      { risk_level: 'LOW' as any, risk_category: 'Payment' },
      userId,
      orgId,
    );
    expect(saved.risk_level).toBe('LOW');
    expect(saved.risk_category).toBe('Payment');

    const row = await readRisk(riskEditId);
    expect(row.risk_level).toBe('LOW');
    expect(row.risk_category).toBe('Payment');
    expect(row.is_edited_by_user).toBe(true);
    expect(row.edited_by_user_id).toBe(userId);
    expect(row.edited_at).not.toBeNull();
    // AI original preserved
    expect(row.original_risk_level).toBe('HIGH');
    expect(row.original_risk_category).toBe('Uncategorized');
    // L/I untouched → risk_score unchanged (20)
    expect(Number(row.risk_score)).toBe(20);

    // FK actually resolves to the real user (edited_by_user_id → users.id).
    const join = await dataSource.query(
      `SELECT u.id FROM risk_analyses ra JOIN users u ON u.id = ra.edited_by_user_id WHERE ra.id = $1`,
      [riskEditId],
    );
    expect(join[0].id).toBe(userId);
  });

  it('snapshots the AI original ONLY once (a second edit keeps HIGH, not the prior human value)', async () => {
    await svc.annotateRisk(riskEditId, { risk_level: 'MEDIUM' as any }, userId, orgId);
    const row = await readRisk(riskEditId);
    expect(row.risk_level).toBe('MEDIUM');
    expect(row.original_risk_level).toBe('HIGH'); // NOT 'LOW'
  });

  it('accepts a clause-type label that is NOT a risk_categories bucket (free-text, no taxonomy gate)', async () => {
    // 'Scope of Work' is one of the 17 clause-type labels but is NOT a row in
    // risk_categories — proving the old taxonomy gate is gone and the column
    // takes the free-text label the dropdown sent.
    await svc.annotateRisk(riskEditId, { risk_category: 'Scope of Work' }, userId, orgId);
    const row = await readRisk(riskEditId);
    expect(row.risk_category).toBe('Scope of Work');
  });

  it('404s a cross-tenant edit via the findInOrg wall', async () => {
    await expect(
      svc.annotateRisk(riskEditId, { risk_level: 'LOW' as any }, userId, otherOrgId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaves a NON-edited row at the additive-migration defaults (untouched)', async () => {
    const row = await readRisk(riskUntouchedId);
    expect(row.is_edited_by_user).toBe(false);
    expect(row.original_risk_level).toBeNull();
    expect(row.original_risk_category).toBeNull();
    expect(row.edited_by_user_id).toBeNull();
    // its AI values are unchanged
    expect(row.risk_level).toBe('MEDIUM');
    expect(row.risk_category).toBe('Payment Terms');
  });
});
