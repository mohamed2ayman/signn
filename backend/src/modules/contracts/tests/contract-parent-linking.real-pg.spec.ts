import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Contract,
  ContractClause,
  ContractVersion,
  ContractRelationshipType,
  GuestContractAccess,
  Clause,
  Project,
  User,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from '../services/contract-access.service';
import { ContractRelationshipTypesService } from '../../contract-relationship-types/contract-relationship-types.service';

/**
 * Multi-tier T0b — parent linking, real Postgres.
 *
 * Exercises ContractsService.create()'s parent-validation block end-to-end
 * against the SEEDED relationship-type registry (migration 1768000000001):
 * required/none/optional rule, allowed_parent_types, the findInOrg cross-tenant
 * wall (404-not-403), the self/cycle guard, and the ON DELETE RESTRICT FK.
 * These are SQL-level facts (FK behaviour, real registry rows, real org walls)
 * that mocks would hide — lesson #140.
 *
 * RED→GREEN: with the migration reverted the parent_contract_id column is
 * absent → every persistence/reject case errors on the missing column. GREEN
 * after the migration + the create() validation proves schema + behaviour.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[t0b-parent-linking] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the FK (ON DELETE RESTRICT), the ' +
      'seeded registry rules, and the cross-tenant wall are real.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('Multi-tier T0b — contract parent linking (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: ContractsService;
  let contractAccess: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();

  // Every contract the test creates/seeds — for FK-safe teardown.
  const contractIds: string[] = [];

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'T0b','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `t0b-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.t0b', org],
    );

  // Create a contract THROUGH the service (the path under test).
  const createContract = async (
    projectId: string,
    org: string,
    userId: string,
    relationshipType: string,
    parentContractId?: string,
  ): Promise<Contract> => {
    const c = await service.create(
      {
        project_id: projectId,
        name: `T0b ${relationshipType} ${randomUUID().slice(0, 6)}`,
        contract_type: 'ADHOC' as any, // non-standard-form → no template instantiation
        relationship_type: relationshipType,
        parent_contract_id: parentContractId,
      } as any,
      userId,
      org,
    );
    contractIds.push(c.id);
    return c;
  };

  const dbRow = async (id: string) =>
    (
      await dataSource.query(
        `SELECT id, relationship_type, parent_contract_id FROM contracts WHERE id = $1`,
        [id],
      )
    )[0];

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
    const relationshipTypes = new ContractRelationshipTypesService(
      dataSource.getRepository(ContractRelationshipType),
    );

    // Positional wiring mirrors the pinning real-PG spec — real repos on the
    // slots create() touches (Contract[1], ContractClause[2], ContractVersion[3],
    // Project[6], User[7], contractAccess[12], Clause[18], relationshipTypes[19]);
    // {} stubs elsewhere (create() with contract_type=ADHOC never reaches them).
    service = new ContractsService(
      dataSource.getRepository(Contract), // 1
      dataSource.getRepository(ContractClause), // 2
      dataSource.getRepository(ContractVersion), // 3
      {} as any, // 4 contractComment
      {} as any, // 5 contractorResponse
      dataSource.getRepository(Project), // 6 project (S0 project→org wall)
      dataSource.getRepository(User), // 7 user (resolveUserRole)
      {} as any, // 8 contractApprover
      {} as any, // 9 collaborationGateway
      {} as any, // 10 contractTemplatesService (skipped for ADHOC)
      {} as any, // 11 emailService
      contractAccess, // 12 contractAccess (findInOrg parent wall)
      {} as any, // 13 contractScoped
      {} as any, // 14 contractVersionScoped
      {} as any, // 15 contractorResponseScoped
      {} as any, // 16 contractApproverScoped
      {} as any, // 17 contractCommentScoped
      dataSource.getRepository(Clause), // 18 clause
      relationshipTypes, // 19 relationshipTypes (registry lookup)
    );

    // The registry (MAIN / SUBCONTRACT / CONSULTANT …) is seeded by migration
    // 1768000000001. Fail fast if it isn't applied on this DB.
    const seeded = await dataSource.query(
      `SELECT code, parent_link_rule, allowed_parent_types FROM contract_relationship_types
        WHERE code = ANY($1) ORDER BY code`,
      [['CONSULTANT', 'MAIN', 'SUBCONTRACT']],
    );
    if (seeded.length !== 3) {
      throw new Error(
        'T0b spec precondition failed: relationship-type registry not seeded ' +
          '(run migration 1768000000001).',
      );
    }

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgA,
      `t0b-orgA-${orgA.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgB,
      `t0b-orgB-${orgB.slice(0, 8)}`,
    ]);
    await insertUser(userA, orgA);
    await insertUser(userB, orgB);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'t0b-projA',$3)`,
      [projectA, orgA, userA],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'t0b-projB',$3)`,
      [projectB, orgB, userB],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // FK is ON DELETE RESTRICT — break all parent links BEFORE deleting rows.
      await dataSource.query(
        `UPDATE contracts SET parent_contract_id = NULL WHERE id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(
        `DELETE FROM contract_versions WHERE contract_id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectA, projectB],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [[userA, userB]]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgA, orgB],
      ]);
    }
    await moduleRef?.close();
  });

  // ── (ii) happy path — SUBCONTRACT under a MAIN, same org ────────────────
  it('⭐ (ii) creates a SUBCONTRACT with a valid MAIN parent in the same org — parent_contract_id persists', async () => {
    const main = await createContract(projectA, orgA, userA, 'MAIN');
    expect(main.parent_contract_id).toBeNull();

    const sub = await createContract(projectA, orgA, userA, 'SUBCONTRACT', main.id);
    expect(sub.parent_contract_id).toBe(main.id);

    const row = await dbRow(sub.id);
    expect(row.relationship_type).toBe('SUBCONTRACT');
    expect(row.parent_contract_id).toBe(main.id);
  });

  // ── (iii) required rule — SUBCONTRACT with NO parent → 400 ───────────────
  it('(iii) rejects a SUBCONTRACT created with NO parent (parent_link_rule=required)', async () => {
    await expect(
      createContract(projectA, orgA, userA, 'SUBCONTRACT'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── (iv) none rule — MAIN with a parent → 400 ───────────────────────────
  it('(iv) rejects a MAIN created WITH a parent (parent_link_rule=none forbids a parent)', async () => {
    const anchor = await createContract(projectA, orgA, userA, 'MAIN');
    await expect(
      createContract(projectA, orgA, userA, 'MAIN', anchor.id),
    ).rejects.toThrow(BadRequestException);
  });

  // ── (v) allowed_parent_types — SUBCONTRACT under a CONSULTANT → 400 ──────
  it('(v) rejects a SUBCONTRACT whose parent is a CONSULTANT (not in allowed_parent_types=[MAIN])', async () => {
    // CONSULTANT is parent_link_rule=optional → it can be created with no parent.
    const consultant = await createContract(projectA, orgA, userA, 'CONSULTANT');
    await expect(
      createContract(projectA, orgA, userA, 'SUBCONTRACT', consultant.id),
    ).rejects.toThrow(BadRequestException);
  });

  // ── (vi) cross-tenant wall — parent in another org → 404 ────────────────
  it('(vi) rejects a parent that belongs to a DIFFERENT org with 404 (findInOrg wall, no existence leak)', async () => {
    const foreignMain = await createContract(projectB, orgB, userB, 'MAIN');
    await expect(
      createContract(projectA, orgA, userA, 'SUBCONTRACT', foreignMain.id),
    ).rejects.toThrow(NotFoundException);
  });

  // ── (vii) self / cycle guard (FULL chain walk, depth-capped 64) ─────────
  it('(vii-a) rejects a child whose parent has a SELF-loop in existing data (X.parent=X)', async () => {
    const x = await createContract(projectA, orgA, userA, 'MAIN');
    // Corrupt the parent's ancestry directly (bypassing the guard) to simulate
    // pre-existing bad data — create() must refuse to link under it.
    await dataSource.query(
      `UPDATE contracts SET parent_contract_id = id WHERE id = $1`,
      [x.id],
    );
    await expect(
      createContract(projectA, orgA, userA, 'SUBCONTRACT', x.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('(vii-b) rejects a child under a parent inside an A↔B reciprocal cycle (full chain walk)', async () => {
    const a = await createContract(projectA, orgA, userA, 'MAIN');
    const b = await createContract(projectA, orgA, userA, 'MAIN');
    await dataSource.query(
      `UPDATE contracts SET parent_contract_id = $2 WHERE id = $1`,
      [a.id, b.id],
    );
    await dataSource.query(
      `UPDATE contracts SET parent_contract_id = $2 WHERE id = $1`,
      [b.id, a.id],
    );
    await expect(
      createContract(projectA, orgA, userA, 'SUBCONTRACT', a.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('(vii-c) the guard rejects parent === self directly (the editable-parent-ready selfId branch)', async () => {
    const m = await createContract(projectA, orgA, userA, 'MAIN');
    const parentEntity = await contractAccess.findInOrg(m.id, orgA);
    await expect(
      // selfId === the parent's own id → immediate self rejection.
      (service as any).assertParentLinkAcyclic(parentEntity, orgA, m.id),
    ).rejects.toThrow(BadRequestException);
  });

  // ── (viii) ON DELETE RESTRICT — deleting a parent with children is blocked ─
  it('⭐ (viii) blocks deleting a parent that still has children (FK ON DELETE RESTRICT)', async () => {
    const parent = await createContract(projectA, orgA, userA, 'MAIN');
    await createContract(projectA, orgA, userA, 'SUBCONTRACT', parent.id);
    await expect(
      dataSource.query(`DELETE FROM contracts WHERE id = $1`, [parent.id]),
    ).rejects.toThrow();
  });

  // ── optional-rule happy paths (CONSULTANT: parent may be absent OR a MAIN) ─
  it('(optional) CONSULTANT persists with NO parent (optional rule allows absence)', async () => {
    const consultant = await createContract(projectA, orgA, userA, 'CONSULTANT');
    expect(consultant.parent_contract_id).toBeNull();
  });

  it('(optional) CONSULTANT persists WITH a valid MAIN parent (optional rule allows presence)', async () => {
    const main = await createContract(projectA, orgA, userA, 'MAIN');
    const consultant = await createContract(
      projectA,
      orgA,
      userA,
      'CONSULTANT',
      main.id,
    );
    expect(consultant.parent_contract_id).toBe(main.id);
  });
});
