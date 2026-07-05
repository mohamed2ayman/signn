import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from '../services/contract-access.service';

/**
 * Party editing + annotation tracking (Tier A swap + Tier B tracking) against
 * REAL Postgres. The swap itself is a frontend draft-cross that arrives here as
 * two already-crossed names; this proves the SERVER side a mocked repo cannot
 * (lesson #140):
 *   - updateParties persists the new (e.g. swapped) names
 *   - is_parties_edited_by_user flips true on the first edit
 *   - the AI ORIGINAL party names are snapshotted EXACTLY ONCE (a second edit
 *     keeps the true original, not the previous human value)
 *   - the findInOrg wall 404s a cross-tenant edit
 *   - a NON-edited contract stays at the additive-migration defaults (untouched:
 *     is_parties_edited_by_user=false, original_party_* NULL, names intact)
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[update-parties] SKIPPING real-Postgres spec: DATABASE_URL unset — this MUST ' +
      'run against Postgres to prove the edit persists, the snapshot-once holds, ' +
      'and the migration is additive.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('ContractsService.updateParties — party editing + tracking (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let svc: ContractsService;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();
  const untouchedContractId = randomUUID();

  const AI_FIRST = 'شركة أوراسكوم (AI)';
  const AI_SECOND = 'شركة تليفونات مصر (AI)';

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Party','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `party-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.party', org],
    );

  const insertContract = (id: string, first: string, second: string) =>
    dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by,
                              party_first_name, party_second_name)
       VALUES ($1,$2,'Party Contract','FIDIC_RED_BOOK',$3,$4,$5)`,
      [id, projectId, userId, first, second],
    );

  const readContract = async (id: string) =>
    (await dataSource.query(`SELECT * FROM contracts WHERE id = $1`, [id]))[0];

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

    const contractRepo = dataSource.getRepository(Contract);
    const contractAccess = new ContractAccessService(
      contractRepo,
      dataSource.getRepository(GuestContractAccess),
    );
    // Stub the scoped repo to return the real entity to mutate — the org gate is
    // enforced by the real contractAccess wall (findById) above it.
    const contractScoped = {
      scopedFindByIdOrThrow: async (id: string) =>
        contractRepo.findOneByOrFail({ id } as any),
    };
    // ctor order (18): 1 contractRepository … 12 contractAccess, 13 contractScoped …
    const Ctor: any = ContractsService;
    svc = new Ctor(
      contractRepo, // 1 contractRepository
      {} as any, // 2 contractClause
      {} as any, // 3 contractVersion
      {} as any, // 4 contractComment
      {} as any, // 5 contractorResponse
      {} as any, // 6 project
      {} as any, // 7 user
      {} as any, // 8 contractApprover
      {} as any, // 9 collaborationGateway
      {} as any, // 10 contractTemplatesService
      {} as any, // 11 emailService
      contractAccess, // 12 contractAccess
      contractScoped, // 13 contractScoped
      {} as any, // 14 contractVersionScoped
      {} as any, // 15 contractorResponseScoped
      {} as any, // 16 contractApproverScoped
      {} as any, // 17 contractCommentScoped
      {} as any, // 18 clauseRepository
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `party-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      otherOrgId,
      `party-other-${otherOrgId.slice(0, 8)}`,
    ]);
    await insertUser(userId, orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'party-project',$3)`,
      [projectId, orgId, userId],
    );
    // Two AI-extracted contracts: one to edit/swap, one to leave untouched.
    await insertContract(contractId, AI_FIRST, AI_SECOND);
    await insertContract(untouchedContractId, 'الطرف الأول الأصلي', 'الطرف الثاني الأصلي');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractId, untouchedContractId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    }
    await moduleRef?.close();
  });

  it('⭐ first edit (swap) persists the crossed names, flips is_parties_edited_by_user, snapshots the AI original once', async () => {
    // A swap arrives as the two names already crossed.
    await svc.updateParties(
      contractId,
      { party_first_name: AI_SECOND, party_second_name: AI_FIRST },
      orgId,
    );

    const row = await readContract(contractId);
    expect(row.party_first_name).toBe(AI_SECOND);
    expect(row.party_second_name).toBe(AI_FIRST);
    expect(row.is_parties_edited_by_user).toBe(true);
    // AI original preserved (pre-swap)
    expect(row.original_party_first_name).toBe(AI_FIRST);
    expect(row.original_party_second_name).toBe(AI_SECOND);
  });

  it('snapshots the AI original ONLY once (a second edit keeps the AI values, not the prior human values)', async () => {
    await svc.updateParties(
      contractId,
      { party_first_name: 'اسم مُصحّح لاحقًا' },
      orgId,
    );
    const row = await readContract(contractId);
    expect(row.party_first_name).toBe('اسم مُصحّح لاحقًا');
    // original still the ORIGINAL AI values — not the post-swap 'AI_SECOND'
    expect(row.original_party_first_name).toBe(AI_FIRST);
    expect(row.original_party_second_name).toBe(AI_SECOND);
    expect(row.is_parties_edited_by_user).toBe(true);
  });

  it('404s a cross-tenant edit via the findInOrg wall', async () => {
    await expect(
      svc.updateParties(contractId, { party_first_name: 'x' }, otherOrgId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaves a NON-edited contract at the additive-migration defaults (untouched)', async () => {
    const row = await readContract(untouchedContractId);
    expect(row.is_parties_edited_by_user).toBe(false);
    expect(row.original_party_first_name).toBeNull();
    expect(row.original_party_second_name).toBeNull();
    // its AI names are unchanged
    expect(row.party_first_name).toBe('الطرف الأول الأصلي');
    expect(row.party_second_name).toBe('الطرف الثاني الأصلي');
  });
});
