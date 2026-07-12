import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Contract,
  ContractParty,
  ContractPartyContact,
  GuestContractAccess,
  Organization,
  PartyRole,
} from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { PartyRolesService } from '../party-roles.service';
import { ContractPartiesService } from '../contract-parties.service';

/**
 * Multi-tier trunk — Slice T0c-1 (ContractParty backend spine), real Postgres.
 *
 * Proven in-container against REAL Postgres (host Postgres.app shadows
 * localhost:5432 — host runs are invalid):
 *  (i)    migration 1770000000001 applied — party_roles seeded with the 11
 *         locked roles; contract_parties + contract_party_contacts exist.
 *  (ii)   GET /party-roles read surface: active-only default,
 *         include_inactive, applies_to narrowing.
 *  (iii)  persistence: party + contacts round-trip through real Postgres
 *         (role_code, is_signatory, organization_id, designated contact).
 *  (iv)   role_code validation: unknown / inactive / project-only → 400,
 *         NO row written.
 *  (v)    tenancy: cross-org contract → 404 (findInOrg wall);
 *         cross-org organization_id link → 404, NO row written.
 *  (vi)   designated-signatory invariant: designated on non-signatory → 400;
 *         two designated → 400; update flipping is_signatory=false while a
 *         designated contact remains → 400.
 *  (vii)  signed-state pinning: party create/update/delete on a pinned
 *         contract → 409 CONTRACT_PINNED (evaluated AFTER the tenancy wall).
 *  (viii) delete: contacts CASCADE with their party.
 *
 * RED→GREEN: this spec was run BEFORE migration 1770000000001 was applied —
 * every DB-touching test failed on `relation "party_roles" does not exist`.
 * A second neutralization run (service validations commented out) flipped
 * the validation tests RED while persistence stayed GREEN — proving each
 * test exercises its own check, none is vacuous.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[contract-parties] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the seed, the tables, and the ' +
      'validation branches. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const SEEDED_CODES = [
  'EMPLOYER',
  'CONTRACTOR',
  'ENGINEERING_CONSULTANT',
  'DESIGN_CONSULTANT',
  'COST_CONSULTANT',
  'SUBCONTRACTOR',
  'SUPPLIER',
  'ENGINEER',
  'GRANTOR',
  'BENEFICIARY',
  'OTHER',
];

const expectContractPinned = async (p: Promise<unknown>): Promise<void> => {
  await expect(p).rejects.toMatchObject({
    response: expect.objectContaining({ error: 'CONTRACT_PINNED' }),
    status: 409,
  });
};

describeReal('contract_parties — Slice T0c-1 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let rolesService: PartyRolesService;
  let partiesService: ContractPartiesService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const ownerAId = randomUUID();
  const projectAId = randomUUID();
  const projectBId = randomUUID();
  const contractIds: string[] = [];

  // Test-only registry rows (the 11 seeded roles are all active +
  // contract-usable, so the rejection branches need synthetic rows).
  const INACTIVE_CODE = `TEST_INACTIVE_${randomUUID().slice(0, 8)}`;
  const PROJECT_ONLY_CODE = `TEST_PROJ_${randomUUID().slice(0, 8)}`;

  const insertUser = (id: string, org: string | null) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'T0c','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [
        id,
        `t0c-${id.slice(0, 8)}@test.local`,
        '$2a$10$dummy.hash.placeholder.t0c',
        org,
      ],
    );

  const insertContract = async (projectId: string): Promise<string> => {
    const id = randomUUID();
    contractIds.push(id);
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by, status,
                              party_first_name, party_second_name)
       VALUES ($1,$2,'T0c Contract','FIDIC_RED_BOOK_2017',$3,'DRAFT','Party A','Party B')`,
      [id, projectId, ownerAId],
    );
    return id;
  };

  /**
   * Pin a contract the minimal honest way: a real contract_versions row +
   * pinned_version_id pointer (assertContractMutable keys on the pointer;
   * the pin OPERATION itself is proven by the Slice-1/2 pinning specs).
   */
  const pinContract = async (contractId: string): Promise<void> => {
    const versionId = randomUUID();
    await dataSource.query(
      `INSERT INTO contract_versions (id, contract_id, version_number, snapshot, is_milestone)
       VALUES ($1,$2,1,'{}'::jsonb,FALSE)`,
      [versionId, contractId],
    );
    await dataSource.query(
      `UPDATE contracts SET pinned_version_id = $2 WHERE id = $1`,
      [contractId, versionId],
    );
  };

  const partyCount = async (contractId: string): Promise<number> =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM contract_parties WHERE contract_id = $1`,
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

    // Positional construction mirrors contract-relationship-types.real-pg.spec.ts.
    const contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );
    rolesService = new PartyRolesService(dataSource.getRepository(PartyRole));
    partiesService = new ContractPartiesService(
      dataSource.getRepository(ContractParty),
      dataSource.getRepository(ContractPartyContact),
      dataSource.getRepository(Organization),
      rolesService,
      contractAccess,
    );

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1,$2)`,
      [orgAId, 't0c-org-A'],
    );
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1,$2)`,
      [orgBId, 't0c-org-B'],
    );
    await insertUser(ownerAId, orgAId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'t0c-project-A',$3)`,
      [projectAId, orgAId, ownerAId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'t0c-project-B',$3)`,
      [projectBId, orgBId, ownerAId],
    );

    // Synthetic registry rows for the rejection branches.
    await dataSource.query(
      `INSERT INTO party_roles (code, label_en, label_ar, label_fr, applies_to, is_active, sort_order)
       VALUES ($1,'Test Inactive','اختبار','Test','both',FALSE,900),
              ($2,'Test Project Only','اختبار','Test','project',TRUE,910)`,
      [INACTIVE_CODE, PROJECT_ONLY_CODE],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (contractIds.length) {
        await dataSource.query(
          `UPDATE contracts SET pinned_version_id = NULL WHERE id = ANY($1)`,
          [contractIds],
        );
        await dataSource.query(
          `DELETE FROM contract_versions WHERE contract_id = ANY($1)`,
          [contractIds],
        );
        // contract_parties + contact rows CASCADE with their contracts.
        await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
          contractIds,
        ]);
      }
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectAId, projectBId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ownerAId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgAId, orgBId],
      ]);
      await dataSource.query(`DELETE FROM party_roles WHERE code = ANY($1)`, [
        [INACTIVE_CODE, PROJECT_ONLY_CODE],
      ]);
    }
    await moduleRef?.close();
  });

  // ── (i) migration + seed ──────────────────────────────────────────────────

  it('party_roles is seeded with the 11 locked roles', async () => {
    const rows: Array<{ code: string; applies_to: string }> =
      await dataSource.query(
        `SELECT code, applies_to FROM party_roles WHERE code = ANY($1) ORDER BY sort_order`,
        [SEEDED_CODES],
      );
    expect(rows.map((r) => r.code)).toEqual(SEEDED_CODES);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.applies_to]));
    expect(byCode.SUPPLIER).toBe('contract');
    expect(byCode.ENGINEER).toBe('contract');
    expect(byCode.GRANTOR).toBe('contract');
    expect(byCode.BENEFICIARY).toBe('contract');
    expect(byCode.EMPLOYER).toBe('both');
    expect(byCode.OTHER).toBe('both');
  });

  // ── (ii) GET /party-roles read surface ────────────────────────────────────

  it('findAll: active-only by default; include_inactive adds inactive rows', async () => {
    const active = await rolesService.findAll();
    expect(active.some((r) => r.code === INACTIVE_CODE)).toBe(false);
    expect(active.some((r) => r.code === 'EMPLOYER')).toBe(true);

    const all = await rolesService.findAll(true);
    expect(all.some((r) => r.code === INACTIVE_CODE)).toBe(true);
  });

  it("findAll(appliesTo='contract') returns only contract/both rows", async () => {
    const contractRoles = await rolesService.findAll(false, 'contract');
    expect(contractRoles.some((r) => r.code === PROJECT_ONLY_CODE)).toBe(false);
    expect(contractRoles.some((r) => r.code === 'SUPPLIER')).toBe(true); // contract
    expect(contractRoles.some((r) => r.code === 'EMPLOYER')).toBe(true); // both
    expect(
      contractRoles.every((r) => ['contract', 'both'].includes(r.applies_to)),
    ).toBe(true);
  });

  // ── (iii) persistence round-trip ⭐ ───────────────────────────────────────

  it('⭐ persists a party + contacts and reloads everything from Postgres', async () => {
    const contractId = await insertContract(projectAId);
    const created = await partiesService.create(contractId, orgAId, {
      role_code: 'EMPLOYER',
      org_name: 'الهيئة القومية للأنفاق',
      is_signatory: true,
      organization_id: orgAId,
      legal_tax_card: 'TAX-123-456',
      legal_address: '123 Corniche El Nil, Cairo',
      contacts: [
        {
          name: 'Ahmed Hassan',
          email: 'ahmed@employer.test',
          title: 'Authorized Director',
          is_designated_signatory: true,
        },
        { name: 'Mona Said', email: 'mona@employer.test' },
      ],
    });
    expect(created.id).toBeDefined();

    // Reload through a FRESH query — not the returned object.
    const [row] = await dataSource.query(
      `SELECT * FROM contract_parties WHERE id = $1`,
      [created.id],
    );
    expect(row.contract_id).toBe(contractId);
    expect(row.role_code).toBe('EMPLOYER');
    expect(row.org_name).toBe('الهيئة القومية للأنفاق');
    expect(row.is_signatory).toBe(true);
    expect(row.organization_id).toBe(orgAId);
    expect(row.legal_tax_card).toBe('TAX-123-456');
    expect(row.legal_address).toBe('123 Corniche El Nil, Cairo');

    const contacts = await dataSource.query(
      `SELECT * FROM contract_party_contacts WHERE contract_party_id = $1 ORDER BY name`,
      [created.id],
    );
    expect(contacts).toHaveLength(2);
    expect(contacts[0].name).toBe('Ahmed Hassan');
    expect(contacts[0].email).toBe('ahmed@employer.test');
    expect(contacts[0].title).toBe('Authorized Director');
    expect(contacts[0].is_designated_signatory).toBe(true);
    expect(contacts[1].name).toBe('Mona Said');
    expect(contacts[1].is_designated_signatory).toBe(false);

    // list() returns it with contacts hydrated.
    const listed = await partiesService.list(contractId, orgAId);
    expect(listed).toHaveLength(1);
    expect(listed[0].contacts).toHaveLength(2);
  });

  it('update: edits fields and FULL-REPLACES contacts when the array is provided', async () => {
    const contractId = await insertContract(projectAId);
    const created = await partiesService.create(contractId, orgAId, {
      role_code: 'CONTRACTOR',
      org_name: 'Old Name Co',
      is_signatory: true,
      contacts: [
        {
          name: 'First Contact',
          email: 'first@c.test',
          is_designated_signatory: true,
        },
      ],
    });

    const updated = await partiesService.update(
      contractId,
      created.id,
      orgAId,
      {
        org_name: 'New Name Co',
        contacts: [{ name: 'Second Contact', email: 'second@c.test' }],
      },
    );
    expect(updated.org_name).toBe('New Name Co');
    expect(updated.role_code).toBe('CONTRACTOR'); // untouched field survives

    const contacts = await dataSource.query(
      `SELECT name FROM contract_party_contacts WHERE contract_party_id = $1`,
      [created.id],
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Second Contact');
  });

  it('delete: removes the party and CASCADE-removes its contacts', async () => {
    const contractId = await insertContract(projectAId);
    const created = await partiesService.create(contractId, orgAId, {
      role_code: 'SUPPLIER',
      org_name: 'Supplier Co',
      contacts: [{ name: 'C', email: 'c@s.test' }],
    });

    await partiesService.remove(contractId, created.id, orgAId);

    expect(await partyCount(contractId)).toBe(0);
    const contacts = await dataSource.query(
      `SELECT id FROM contract_party_contacts WHERE contract_party_id = $1`,
      [created.id],
    );
    expect(contacts).toHaveLength(0);
  });

  // ── (iv) role_code validation ─────────────────────────────────────────────

  it('rejects an UNKNOWN role_code with 400 and writes no row', async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: 'NOT_A_ROLE',
        org_name: 'X',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await partyCount(contractId)).toBe(0);
  });

  it('rejects an INACTIVE role_code with 400 and writes no row', async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: INACTIVE_CODE,
        org_name: 'X',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await partyCount(contractId)).toBe(0);
  });

  it("rejects a PROJECT-ONLY role_code (applies_to='project') with 400 and writes no row", async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: PROJECT_ONLY_CODE,
        org_name: 'X',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await partyCount(contractId)).toBe(0);
  });

  // ── (v) tenancy walls ─────────────────────────────────────────────────────

  it('⭐ cross-org contract → 404 (findInOrg wall), never 403, no row written', async () => {
    const contractBId = await insertContract(projectBId); // org B's contract
    await expect(
      partiesService.create(contractBId, orgAId, {
        role_code: 'EMPLOYER',
        org_name: 'X',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(partiesService.list(contractBId, orgAId)).rejects.toThrow(
      NotFoundException,
    );
    expect(await partyCount(contractBId)).toBe(0);
  });

  it('⭐ cross-org organization_id link → 404, no row written', async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: 'EMPLOYER',
        org_name: 'X',
        organization_id: orgBId, // REAL foreign org — must still be 404
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await partyCount(contractId)).toBe(0);
  });

  // ── (vi) designated-signatory invariant ───────────────────────────────────

  it('rejects a designated-signatory contact on a NON-signatory party (400)', async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: 'EMPLOYER',
        org_name: 'X',
        is_signatory: false,
        contacts: [
          { name: 'C', email: 'c@x.test', is_designated_signatory: true },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await partyCount(contractId)).toBe(0);
  });

  it('rejects TWO designated-signatory contacts on one party (400)', async () => {
    const contractId = await insertContract(projectAId);
    await expect(
      partiesService.create(contractId, orgAId, {
        role_code: 'EMPLOYER',
        org_name: 'X',
        is_signatory: true,
        contacts: [
          { name: 'C1', email: 'c1@x.test', is_designated_signatory: true },
          { name: 'C2', email: 'c2@x.test', is_designated_signatory: true },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await partyCount(contractId)).toBe(0);
  });

  it('update flipping is_signatory=false while a designated contact REMAINS → 400', async () => {
    const contractId = await insertContract(projectAId);
    const created = await partiesService.create(contractId, orgAId, {
      role_code: 'EMPLOYER',
      org_name: 'X',
      is_signatory: true,
      contacts: [
        { name: 'C', email: 'c@x.test', is_designated_signatory: true },
      ],
    });
    // contacts NOT supplied → existing designated contact kept → invariant fires.
    await expect(
      partiesService.update(contractId, created.id, orgAId, {
        is_signatory: false,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── (vii) signed-state pinning ────────────────────────────────────────────

  it('⭐ party create/update/delete on a PINNED contract → 409 CONTRACT_PINNED', async () => {
    const contractId = await insertContract(projectAId);
    // Seed a party BEFORE pinning so update/delete have a target.
    const party = await partiesService.create(contractId, orgAId, {
      role_code: 'EMPLOYER',
      org_name: 'Pre-pin Party',
    });
    await pinContract(contractId);

    await expectContractPinned(
      partiesService.create(contractId, orgAId, {
        role_code: 'CONTRACTOR',
        org_name: 'Post-pin Party',
      }),
    );
    await expectContractPinned(
      partiesService.update(contractId, party.id, orgAId, {
        org_name: 'Mutated',
      }),
    );
    await expectContractPinned(
      partiesService.remove(contractId, party.id, orgAId),
    );

    // Frozen: exactly the pre-pin party, unchanged.
    expect(await partyCount(contractId)).toBe(1);
    const [row] = await dataSource.query(
      `SELECT org_name FROM contract_parties WHERE id = $1`,
      [party.id],
    );
    expect(row.org_name).toBe('Pre-pin Party');

    // Reads stay open on a pinned contract.
    const listed = await partiesService.list(contractId, orgAId);
    expect(listed).toHaveLength(1);
  });
});
