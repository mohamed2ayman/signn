import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Contract,
  ContractClause,
  ContractRelationshipType,
  ContractType,
  ContractVersion,
  Clause,
  GuestContractAccess,
  Project,
  User,
} from '../../../database/entities';
import { ContractRelationshipTypesService } from '../contract-relationship-types.service';
import { ContractRelationshipTypesController } from '../contract-relationship-types.controller';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

/**
 * Multi-tier trunk — Slice T0a (relationship-type registry + field).
 *
 * Proven against REAL Postgres (must run in-container — the host Postgres.app
 * shadows localhost:5432):
 *  (i)   migration 1768000000001 applied — the 10 seeded registry rows carry
 *        the locked metadata; contracts has the nullable relationship_type
 *        column.
 *  (ii)  the read surface returns the 7 ACTIVE types by default and all 10
 *        only when include_inactive is requested; JwtAuthGuard is on the
 *        controller.
 *  (iii) create() with relationship_type=MAIN persists the code.
 *  (iv)  create() with an unknown (FOO) or seeded-but-INACTIVE (JOINT_VENTURE)
 *        code is rejected with a clear 400 and writes NO contract row.
 *  (v)   create() with NO relationship_type still succeeds (nullable,
 *        backward-compat) and stores NULL.
 *
 * RED→GREEN: this spec was run BEFORE migration 1768000000001 was applied —
 * every DB-touching test failed on `relation "contract_relationship_types"
 * does not exist` / missing column. GREEN below proves the migration + wiring,
 * not just the code paths.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[contract-relationship-types] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the registry seed, the contracts ' +
      'column, and the create-path validation. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const ACTIVE_CODES = [
  'MAIN',
  'SUBCONTRACT',
  'NOMINATED_SUB',
  'NOMINATED_SUPPLIER',
  'SUPPLY_DIRECT',
  'CONSULTANT',
  'USUFRUCT',
];
const INACTIVE_CODES = ['JOINT_VENTURE', 'FRAMEWORK', 'NOVATION'];

describeReal('contract_relationship_types — Slice T0a (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let registryService: ContractRelationshipTypesService;
  let controller: ContractRelationshipTypesController;
  let contracts: ContractsService;

  const orgId = randomUUID();
  const ownerId = randomUUID();
  const projectId = randomUUID();

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

    registryService = new ContractRelationshipTypesService(
      dataSource.getRepository(ContractRelationshipType),
    );
    controller = new ContractRelationshipTypesController(registryService);

    const contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );
    // Positional construction mirrors apply-proposed-version.real-pg.spec.ts:
    // real repos for everything create() touches; {} for deps it never reaches
    // (ADHOC contract_type → no template instantiation, no gateway/email).
    contracts = new ContractsService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(ContractVersion),
      {} as any,
      {} as any,
      dataSource.getRepository(Project),
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
      registryService,
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `rel-type-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'RelType','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [ownerId, `rel-type-${ownerId.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.rel.type.test', orgId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'rel-type-project',$3)`,
      [projectId, orgId, ownerId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM contract_versions WHERE contract_id IN (SELECT id FROM contracts WHERE project_id = $1)`,
        [projectId],
      );
      await dataSource.query(`DELETE FROM contracts WHERE project_id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await moduleRef?.close();
  });

  const createDto = (overrides: Record<string, unknown> = {}) => ({
    project_id: projectId,
    name: `rel-type-contract-${randomUUID().slice(0, 8)}`,
    contract_type: ContractType.ADHOC,
    ...overrides,
  });

  // ─── (i) migration + seed ─────────────────────────────────────────────────

  describe('(i) migration applied — registry seeded, contracts column present', () => {
    it('seeds exactly the 10 locked rows (7 active + 3 inactive)', async () => {
      const rows = await dataSource.query(
        `SELECT code, is_active FROM contract_relationship_types ORDER BY sort_order ASC`,
      );
      expect(rows).toHaveLength(10);
      expect(rows.map((r: any) => r.code)).toEqual([...ACTIVE_CODES, ...INACTIVE_CODES]);
      expect(rows.filter((r: any) => r.is_active).map((r: any) => r.code)).toEqual(ACTIVE_CODES);
    });

    it('SUBCONTRACT carries the locked delivery-chain metadata', async () => {
      const [row] = await dataSource.query(
        `SELECT * FROM contract_relationship_types WHERE code = 'SUBCONTRACT'`,
      );
      expect(row.label_en).toBe('Sub-Contract');
      expect(row.label_ar).toBeTruthy();
      expect(row.label_fr).toBe('Sous-contrat');
      expect(row.domain_group).toBe('delivery_chain');
      expect(row.parent_link_rule).toBe('required');
      expect(row.allowed_parent_types).toEqual(['MAIN']);
      expect(row.default_signatory_role_1).toBe('CONTRACTOR');
      expect(row.default_signatory_role_2).toBe('SUBCONTRACTOR');
      expect(row.is_active).toBe(true);
    });

    it('USUFRUCT carries the property-rights metadata with the NEW role codes', async () => {
      const [row] = await dataSource.query(
        `SELECT * FROM contract_relationship_types WHERE code = 'USUFRUCT'`,
      );
      expect(row.domain_group).toBe('property_rights');
      expect(row.parent_link_rule).toBe('none');
      expect(row.allowed_parent_types).toEqual([]);
      expect(row.default_signatory_role_1).toBe('GRANTOR');
      expect(row.default_signatory_role_2).toBe('BENEFICIARY');
    });

    it('the 3 party_agreement types are seeded INACTIVE with null roles', async () => {
      const rows = await dataSource.query(
        `SELECT code, domain_group, is_active, default_signatory_role_1, default_signatory_role_2
           FROM contract_relationship_types WHERE code = ANY($1) ORDER BY sort_order ASC`,
        [INACTIVE_CODES],
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.domain_group).toBe('party_agreement');
        expect(row.is_active).toBe(false);
        expect(row.default_signatory_role_1).toBeNull();
        expect(row.default_signatory_role_2).toBeNull();
      }
    });

    it('contracts.relationship_type exists as nullable varchar(50)', async () => {
      const [col] = await dataSource.query(
        `SELECT data_type, is_nullable, character_maximum_length
           FROM information_schema.columns
          WHERE table_name = 'contracts' AND column_name = 'relationship_type'`,
      );
      expect(col).toBeDefined();
      expect(col.data_type).toBe('character varying');
      expect(col.is_nullable).toBe('YES');
      expect(col.character_maximum_length).toBe(50);
    });
  });

  // ─── (ii) read surface ────────────────────────────────────────────────────

  describe('(ii) GET /contract-relationship-types', () => {
    it('service default returns the 7 ACTIVE types, sort_order ascending', async () => {
      const rows = await registryService.findAll();
      expect(rows.map((r) => r.code)).toEqual(ACTIVE_CODES);
      expect(rows.every((r) => r.is_active)).toBe(true);
      // Metadata rides along — the endpoint is the single metadata source.
      const main = rows.find((r) => r.code === 'MAIN')!;
      expect(main.label_en).toBe('Main Contract');
      expect(main.parent_link_rule).toBe('none');
      expect(main.default_signatory_role_1).toBe('EMPLOYER');
      expect(main.default_signatory_role_2).toBe('CONTRACTOR');
    });

    it('include_inactive returns all 10 (controller param mapping)', async () => {
      const activeOnly = await controller.list(undefined);
      expect(activeOnly).toHaveLength(7);
      const all = await controller.list('true');
      expect(all).toHaveLength(10);
      expect(all.map((r) => r.code)).toEqual([...ACTIVE_CODES, ...INACTIVE_CODES]);
    });

    it('controller is JwtAuthGuard-gated', () => {
      const guards = Reflect.getMetadata('__guards__', ContractRelationshipTypesController) ?? [];
      expect(guards).toContain(JwtAuthGuard);
    });
  });

  // ─── (iii)–(v) create-path ────────────────────────────────────────────────

  describe('(iii) create with relationship_type=MAIN persists', () => {
    it('persists and returns the code', async () => {
      const dto = createDto({ relationship_type: 'MAIN' });
      const created = await contracts.create(dto as any, ownerId, orgId);
      expect(created.relationship_type).toBe('MAIN');

      const [row] = await dataSource.query(
        `SELECT relationship_type FROM contracts WHERE id = $1`,
        [created.id],
      );
      expect(row.relationship_type).toBe('MAIN');
    });
  });

  describe('(iv) unknown / inactive codes are rejected — no row written', () => {
    it.each([
      ['unknown code', 'FOO'],
      ['seeded-but-inactive code', 'JOINT_VENTURE'],
    ])('rejects a %s with a clear 400', async (_label, code) => {
      const dto = createDto({ relationship_type: code });
      await expect(contracts.create(dto as any, ownerId, orgId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(contracts.create(dto as any, ownerId, orgId)).rejects.toThrow(
        new RegExp(`Unknown or inactive relationship type: ${code}`),
      );
      const rows = await dataSource.query(
        `SELECT id FROM contracts WHERE project_id = $1 AND name = $2`,
        [projectId, dto.name],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('(v) no relationship_type — backward-compat', () => {
    it('creates fine and stores NULL (unclassified/legacy)', async () => {
      const dto = createDto();
      const created = await contracts.create(dto as any, ownerId, orgId);
      expect(created.relationship_type).toBeNull();

      const [row] = await dataSource.query(
        `SELECT relationship_type FROM contracts WHERE id = $1`,
        [created.id],
      );
      expect(row.relationship_type).toBeNull();
    });
  });

  // Adversarial-review fix (T0a): '' slipped past BOTH the DTO layer
  // (@IsString/@MaxLength accept '') and the service truthiness gate, and
  // `'' ?? null` preserved '' — persisting an empty string instead of NULL.
  // create() now NORMALIZES first: ''/whitespace-only → NULL; codes trimmed.
  describe("(v-b) '' / whitespace normalization — never persist ''", () => {
    it.each([
      ['empty string', ''],
      ['whitespace-only', '   '],
    ])('%s normalizes to NULL (same absence as omitted)', async (_label, value) => {
      const dto = createDto({ relationship_type: value });
      const created = await contracts.create(dto as any, ownerId, orgId);
      expect(created.relationship_type).toBeNull();

      const [row] = await dataSource.query(
        `SELECT relationship_type FROM contracts WHERE id = $1`,
        [created.id],
      );
      expect(row.relationship_type).toBeNull();
    });

    it('a padded valid code is trimmed, validated, and persisted clean', async () => {
      const dto = createDto({ relationship_type: '  MAIN  ' });
      const created = await contracts.create(dto as any, ownerId, orgId);
      expect(created.relationship_type).toBe('MAIN');

      const [row] = await dataSource.query(
        `SELECT relationship_type FROM contracts WHERE id = $1`,
        [created.id],
      );
      expect(row.relationship_type).toBe('MAIN');
    });

    it('a padded UNKNOWN code is still rejected (trim does not weaken validation)', async () => {
      const dto = createDto({ relationship_type: '  FOO  ' });
      await expect(contracts.create(dto as any, ownerId, orgId)).rejects.toThrow(
        /Unknown or inactive relationship type: FOO/,
      );
    });
  });
});
