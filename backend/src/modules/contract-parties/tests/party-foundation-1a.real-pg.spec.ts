import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  PartyRole,
  Project,
  ProjectMember,
  User,
} from '../../../database/entities';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';
import { ContractRelationshipTypesService } from '../../contract-relationship-types/contract-relationship-types.service';
import { ContractRelationshipType } from '../../../database/entities';
import { ProjectsService } from '../../projects/projects.service';
import { PartyRolesService } from '../party-roles.service';

/**
 * Party Foundation — Slice 1a, proven on real Postgres (in-container against
 * docker sign-postgres; host 5432 is a stale shadow — never use it).
 *
 * Proves migration 1776000000001's END STATE (the 22-code registry with
 * categories, the untouched existing sort_orders, the inactive-until-1b gate)
 * and the two new soft-reference columns' service-layer validation:
 *  - contracts.host_party_role_code  (ContractsService create + update)
 *  - projects.default_party_role_code (ProjectsService create + update)
 * Unknown codes 400, INACTIVE codes 400 (what keeps the 11 new roles
 * unselectable until Slice 1b), valid ACTIVE codes persist + read back, and
 * cross-org attempts 404 exactly like every other contract/project mutation
 * (findInOrg wall / org-scoped findOne — no existence leak) with ZERO writes.
 *
 * Migration up/down round-trip is exercised OUTSIDE jest via the typeorm CLI
 * (revert + re-run with before/after dumps); this spec asserts the applied end
 * state and fails fast if the migration isn't applied on this DB.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[party-foundation-1a] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the seed, the backfill, and ' +
      'the validation branches. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

/** The 11 pre-1a roles with their locked, never-touched sort_orders. */
const EXISTING_SORT: Record<string, number> = {
  EMPLOYER: 10,
  CONTRACTOR: 20,
  ENGINEERING_CONSULTANT: 30,
  DESIGN_CONSULTANT: 40,
  COST_CONSULTANT: 50,
  SUBCONTRACTOR: 60,
  SUPPLIER: 70,
  ENGINEER: 80,
  GRANTOR: 90,
  BENEFICIARY: 100,
  OTHER: 110,
};

/** The 11 codes seeded INACTIVE by 1776000000001. */
const NEW_1A_CODES = [
  'DEVELOPER',
  'GOVERNMENT_AUTHORITY',
  'EPC_CONTRACTOR',
  'NOMINATED_SUBCONTRACTOR',
  'SUPERVISION_CONSULTANT',
  'PROJECT_MANAGER',
  'PROJECT_MANAGEMENT_CONSULTANT',
  'CONCESSIONAIRE',
  'OPERATOR',
  'GUARANTOR',
  'LENDER',
];

const ALL_22 = [...Object.keys(EXISTING_SORT), ...NEW_1A_CODES];

describeReal('Party Foundation — Slice 1a (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let partyRoles: PartyRolesService;
  let contractsService: ContractsService;
  let projectsService: ProjectsService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const projectAId = randomUUID();
  const contractIds: string[] = [];
  const projectIds: string[] = [projectAId];

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'S1a','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [
        id,
        `s1a-${id.slice(0, 8)}@test.local`,
        '$2a$10$dummy.hash.placeholder.s1a',
        org,
      ],
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

    // Fail fast if migration 1776000000001 is not applied on this DB.
    const cols = await dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM information_schema.columns
            WHERE table_name='party_roles' AND column_name='category')
       + (SELECT COUNT(*)::int FROM information_schema.columns
            WHERE table_name='contracts' AND column_name='host_party_role_code')
       + (SELECT COUNT(*)::int FROM information_schema.columns
            WHERE table_name='projects' AND column_name='default_party_role_code') AS n`,
    );
    if (Number(cols[0].n) !== 3) {
      throw new Error(
        'Slice 1a spec precondition failed: migration 1776000000001 not ' +
          'applied (missing category / host_party_role_code / ' +
          'default_party_role_code).',
      );
    }

    partyRoles = new PartyRolesService(dataSource.getRepository(PartyRole));
    const contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );
    const relationshipTypes = new ContractRelationshipTypesService(
      dataSource.getRepository(ContractRelationshipType),
    );

    // Positional wiring mirrors contract-parent-linking + negotiation-status
    // real-PG specs: real repos on the slots create()/update() touch, {} stubs
    // elsewhere (ADHOC contracts never reach templates/email/gateway).
    contractsService = new ContractsService(
      dataSource.getRepository(Contract), // 1
      dataSource.getRepository(ContractClause), // 2
      dataSource.getRepository(ContractVersion), // 3
      {} as any, // 4 contractComment
      {} as any, // 5 contractorResponse
      dataSource.getRepository(Project), // 6 project (S0 project→org wall)
      dataSource.getRepository(User), // 7 user (resolveUserRole)
      {} as any, // 8 contractApprover
      {} as any, // 9 collaborationGateway
      {} as any, // 10 contractTemplatesService (ADHOC skips)
      {} as any, // 11 emailService
      contractAccess, // 12 the findInOrg wall (cross-org 404)
      // 13 — update() loads its mutation target through the scoped repo: REAL.
      new ContractScopedRepository(dataSource.getRepository(Contract)),
      {} as any, // 14 contractVersionScoped
      {} as any, // 15 contractorResponseScoped
      {} as any, // 16 contractApproverScoped
      {} as any, // 17 contractCommentScoped
      dataSource.getRepository(Clause), // 18 clause
      relationshipTypes, // 19 relationship-type registry
      {} as any, // 20 negotiationStatus (share hook not exercised)
      partyRoles, // 21 — Slice 1a: the party-role registry under test
    );

    projectsService = new ProjectsService(
      dataSource.getRepository(Project), // 1
      dataSource.getRepository(ProjectMember), // 2
      {} as any, // 3 contract (dashboard aggregations — not exercised)
      {} as any, // 4 projectParty
      {} as any, // 5 riskAnalysis
      partyRoles, // 6 — Slice 1a: the party-role registry under test
    );

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1,$2), ($3,$4)`,
      [orgAId, `s1a-orgA-${orgAId.slice(0, 8)}`, orgBId, `s1a-orgB-${orgBId.slice(0, 8)}`],
    );
    await insertUser(userAId, orgAId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1,$2,$3,$4)`,
      [projectAId, orgAId, 's1a project A', userAId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (contractIds.length) {
        await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
          contractIds,
        ]);
      }
      await dataSource.query(
        `DELETE FROM project_members WHERE project_id = ANY($1)`,
        [projectIds],
      );
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        projectIds,
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [userAId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgAId, orgBId],
      ]);
    }
    await moduleRef?.close();
  });

  const mkContract = async (): Promise<string> => {
    const c = await contractsService.create(
      {
        project_id: projectAId,
        name: `S1a ${randomUUID().slice(0, 6)}`,
        contract_type: 'ADHOC' as any, // non-standard-form → no template
      } as any,
      userAId,
      orgAId,
    );
    contractIds.push(c.id);
    return c.id;
  };

  const readHostRole = async (contractId: string): Promise<string | null> =>
    (
      await dataSource.query(
        `SELECT host_party_role_code FROM contracts WHERE id = $1`,
        [contractId],
      )
    )[0].host_party_role_code;

  const readDefaultRole = async (projectId: string): Promise<string | null> =>
    (
      await dataSource.query(
        `SELECT default_party_role_code FROM projects WHERE id = $1`,
        [projectId],
      )
    )[0].default_party_role_code;

  // ── (i) the registry end state after migration 1776000000001 ─────────────

  it('all 22 codes are present, each with non-empty label_en/label_ar/label_fr', async () => {
    const rows: Array<{
      code: string;
      label_en: string;
      label_ar: string;
      label_fr: string;
    }> = await dataSource.query(
      `SELECT code, label_en, label_ar, label_fr FROM party_roles
        WHERE code = ANY($1) ORDER BY code`,
      [ALL_22],
    );
    expect(rows.map((r) => r.code).sort()).toEqual([...ALL_22].sort());
    for (const r of rows) {
      expect(r.label_en?.trim()).toBeTruthy();
      expect(r.label_ar?.trim()).toBeTruthy();
      expect(r.label_fr?.trim()).toBeTruthy();
    }
  });

  it('the 11 new codes are is_active = FALSE; the existing 11 are TRUE', async () => {
    const rows: Array<{ code: string; is_active: boolean }> =
      await dataSource.query(
        `SELECT code, is_active FROM party_roles WHERE code = ANY($1)`,
        [ALL_22],
      );
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.is_active]));
    for (const code of NEW_1A_CODES) expect(byCode[code]).toBe(false);
    for (const code of Object.keys(EXISTING_SORT)) {
      expect(byCode[code]).toBe(true);
    }
  });

  it("every code except OTHER has a category; OTHER's category is NULL", async () => {
    const rows: Array<{ code: string; category: string | null }> =
      await dataSource.query(
        `SELECT code, category FROM party_roles WHERE code = ANY($1)`,
        [ALL_22],
      );
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.category]));
    expect(byCode.OTHER).toBeNull();
    for (const code of ALL_22.filter((c) => c !== 'OTHER')) {
      expect(byCode[code]).toEqual(expect.any(String));
    }
  });

  it('category counts are exactly EMPLOYER_SIDE 3 / CONTRACTOR_SIDE 5 / CONSULTANTS 7 / FINANCIAL 3 / CONCESSION 3', async () => {
    const rows: Array<{ category: string; n: number }> =
      await dataSource.query(
        `SELECT category, COUNT(*)::int AS n FROM party_roles
          WHERE code = ANY($1) AND category IS NOT NULL
          GROUP BY category ORDER BY category`,
        [ALL_22],
      );
    expect(
      Object.fromEntries(rows.map((r) => [r.category, Number(r.n)])),
    ).toEqual({
      CONCESSION: 3,
      CONSULTANTS: 7,
      CONTRACTOR_SIDE: 5,
      EMPLOYER_SIDE: 3,
      FINANCIAL: 3,
    });
  });

  it("the existing 11 rows' sort_order values are UNCHANGED (exact 10..110 → code mapping)", async () => {
    const rows: Array<{ code: string; sort_order: number }> =
      await dataSource.query(
        `SELECT code, sort_order FROM party_roles WHERE code = ANY($1)`,
        [Object.keys(EXISTING_SORT)],
      );
    expect(
      Object.fromEntries(rows.map((r) => [r.code, Number(r.sort_order)])),
    ).toEqual(EXISTING_SORT);
  });

  it('the 22 sort_order values are distinct (the new 11 interleave without collisions)', async () => {
    const rows: Array<{ sort_order: number }> = await dataSource.query(
      `SELECT sort_order FROM party_roles WHERE code = ANY($1)`,
      [ALL_22],
    );
    const values = rows.map((r) => Number(r.sort_order));
    expect(new Set(values).size).toBe(22);
  });

  it('TEST_ rows (other specs’ synthetic fixtures) are untouched: no category was backfilled onto them', async () => {
    // contract-parties.real-pg.spec.ts creates/deletes TEST_* rows; whatever
    // residue exists, the 1a backfill must not have touched it — the backfill
    // targets only the 11 named codes.
    const rows: Array<{ code: string; category: string | null }> =
      await dataSource.query(
        `SELECT code, category FROM party_roles WHERE code LIKE 'TEST\\_%'`,
      );
    for (const r of rows) expect(r.category).toBeNull();
  });

  // ── (ii) the GET /party-roles read surface ────────────────────────────────

  it('findAll (the GET /party-roles list) returns labels ×3 AND category AND sort_order', async () => {
    const all = await partyRoles.findAll();
    const employer = all.find((r) => r.code === 'EMPLOYER');
    expect(employer).toBeDefined();
    expect(employer!.label_en).toBe('Employer');
    expect(employer!.label_ar?.trim()).toBeTruthy();
    expect(employer!.label_fr?.trim()).toBeTruthy();
    expect(employer!.category).toBe('EMPLOYER_SIDE');
    expect(Number(employer!.sort_order)).toBe(10);
  });

  it('findAll default (active-only) HIDES the 11 new inactive roles; include_inactive reveals them', async () => {
    const activeOnly = await partyRoles.findAll();
    for (const code of NEW_1A_CODES) {
      expect(activeOnly.some((r) => r.code === code)).toBe(false);
    }
    const withInactive = await partyRoles.findAll(true);
    for (const code of NEW_1A_CODES) {
      expect(withInactive.some((r) => r.code === code)).toBe(true);
    }
  });

  // ── (iii) contracts.host_party_role_code ──────────────────────────────────

  it('create: a valid ACTIVE code persists and reads back', async () => {
    const c = await contractsService.create(
      {
        project_id: projectAId,
        name: `S1a host-role ${randomUUID().slice(0, 6)}`,
        contract_type: 'ADHOC' as any,
        host_party_role_code: 'EMPLOYER',
      } as any,
      userAId,
      orgAId,
    );
    contractIds.push(c.id);
    expect(await readHostRole(c.id)).toBe('EMPLOYER');
  });

  it('create: an unknown code is rejected 400 and nothing persists', async () => {
    const before = contractIds.length;
    await expect(
      contractsService.create(
        {
          project_id: projectAId,
          name: 's1a bad code',
          contract_type: 'ADHOC' as any,
          host_party_role_code: 'NOT_A_ROLE',
        } as any,
        userAId,
        orgAId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contractIds.length).toBe(before);
  });

  it('create: an INACTIVE code (a 1a-seeded role, pre-1b) is rejected 400', async () => {
    await expect(
      contractsService.create(
        {
          project_id: projectAId,
          name: 's1a inactive code',
          contract_type: 'ADHOC' as any,
          host_party_role_code: 'DEVELOPER',
        } as any,
        userAId,
        orgAId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: valid code persists; unknown 400; inactive 400; "" clears to NULL', async () => {
    const id = await mkContract();

    const updated = await contractsService.update(
      id,
      { host_party_role_code: 'CONTRACTOR' } as any,
      orgAId,
    );
    expect(updated.host_party_role_code).toBe('CONTRACTOR');
    expect(await readHostRole(id)).toBe('CONTRACTOR');

    await expect(
      contractsService.update(
        id,
        { host_party_role_code: 'NOT_A_ROLE' } as any,
        orgAId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await readHostRole(id)).toBe('CONTRACTOR'); // unchanged

    await expect(
      contractsService.update(
        id,
        { host_party_role_code: 'LENDER' } as any, // seeded inactive
        orgAId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await readHostRole(id)).toBe('CONTRACTOR'); // unchanged

    await contractsService.update(
      id,
      { host_party_role_code: '' } as any,
      orgAId,
    );
    expect(await readHostRole(id)).toBeNull();
  });

  it('cross-org: setting host_party_role_code through another org 404s (findInOrg wall) with ZERO writes', async () => {
    const id = await mkContract();
    await expect(
      contractsService.update(
        id,
        { host_party_role_code: 'EMPLOYER' } as any,
        orgBId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await readHostRole(id)).toBeNull();
  });

  // ── (iv) projects.default_party_role_code ─────────────────────────────────

  it('create: a valid ACTIVE code persists and reads back', async () => {
    const p = await projectsService.create(orgAId, userAId, {
      name: `s1a default-role ${randomUUID().slice(0, 6)}`,
      default_party_role_code: 'ENGINEER',
    } as any);
    projectIds.push(p.id);
    expect(await readDefaultRole(p.id)).toBe('ENGINEER');
  });

  it('create: unknown code 400; INACTIVE code 400 (nothing persists)', async () => {
    await expect(
      projectsService.create(orgAId, userAId, {
        name: 's1a bad default',
        default_party_role_code: 'NOT_A_ROLE',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      projectsService.create(orgAId, userAId, {
        name: 's1a inactive default',
        default_party_role_code: 'OPERATOR', // seeded inactive
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    const orphans = await dataSource.query(
      `SELECT COUNT(*)::int AS n FROM projects
        WHERE name IN ('s1a bad default','s1a inactive default')`,
    );
    expect(Number(orphans[0].n)).toBe(0);
  });

  it('update: valid code persists; unknown 400; inactive 400; "" clears to NULL', async () => {
    const updated = await projectsService.update(projectAId, orgAId, {
      default_party_role_code: 'SUPPLIER',
    } as any);
    expect(updated.default_party_role_code).toBe('SUPPLIER');
    expect(await readDefaultRole(projectAId)).toBe('SUPPLIER');

    await expect(
      projectsService.update(projectAId, orgAId, {
        default_party_role_code: 'NOT_A_ROLE',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await readDefaultRole(projectAId)).toBe('SUPPLIER'); // unchanged

    await expect(
      projectsService.update(projectAId, orgAId, {
        default_party_role_code: 'GUARANTOR', // seeded inactive
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await readDefaultRole(projectAId)).toBe('SUPPLIER'); // unchanged

    await projectsService.update(projectAId, orgAId, {
      default_party_role_code: '',
    } as any);
    expect(await readDefaultRole(projectAId)).toBeNull();
  });

  it('cross-org: setting default_party_role_code through another org 404s (org-scoped findOne) with ZERO writes', async () => {
    await expect(
      projectsService.update(projectAId, orgBId, {
        default_party_role_code: 'EMPLOYER',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await readDefaultRole(projectAId)).toBeNull();
  });
});
