import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookScope,
  PlaybookThresholdDirection,
} from '../../../database/entities';
import { PlaybookService } from '../playbook.service';

/**
 * 7.22 Slice 1 — PlaybookService against REAL Postgres.
 *
 * Real PG rather than a mocked repository is deliberate and load-bearing:
 *   - The ORG WALL is a tenancy invariant. A mocked repo would return whatever
 *     the mock was told to return, so it would prove nothing about the actual
 *     `WHERE organization_id = ?` predicate (lesson #140, mock-blindness).
 *   - `value_config` is jsonb — only a real round-trip proves the typed shape
 *     survives storage.
 *   - The DB-level CHECK constraints (scope coherence, soft-code allowlists)
 *     and the FK on-delete semantics do not exist at all under a mock.
 *
 * MUST run IN-CONTAINER: the host's native Postgres shadows localhost:5432, so
 * a host run can silently hit a different database (the same warning carried by
 * contract-parties.real-pg.spec.ts).
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[playbook] SKIPPING real-Postgres spec: DATABASE_URL unset — this MUST ' +
      'run against Postgres to prove the org wall, the jsonb round-trip, and ' +
      'the DB CHECK constraints. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// Real-PG bootstrap (connect + autoLoadEntities over the full entity set)
// exceeds jest's 5s default hook timeout — the negotiation-status.real-pg
// precedent.
jest.setTimeout(60000);

describeReal('PlaybookService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: PlaybookService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const projectAId = randomUUID();
  const projectBId = randomUUID();
  let contractAId: string;

  const rangeDto = () => ({
    clause_type: 'payment',
    rule_type: PlaybookRuleType.RANGE,
    value_config: { min: 28, max: 45, unit: 'days' },
  });

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Playbook','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `pb-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.pb', org],
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
    service = new PlaybookService(dataSource.getRepository(PlaybookPosition));

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgAId,
      'pb-org-A',
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgBId,
      'pb-org-B',
    ]);
    await insertUser(userAId, orgAId);
    await insertUser(userBId, orgBId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pb-project-A',$3)`,
      [projectAId, orgAId, userAId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pb-project-B',$3)`,
      [projectBId, orgBId, userBId],
    );
    contractAId = randomUUID();
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by, status,
                              party_first_name, party_second_name)
       VALUES ($1,$2,'PB Contract','FIDIC_RED_BOOK_2017',$3,'DRAFT','A','B')`,
      [contractAId, projectAId, userAId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // playbook_positions CASCADE with their organization, but delete
      // explicitly so a failure here is visible rather than masked.
      await dataSource.query(
        `DELETE FROM playbook_positions WHERE organization_id = ANY($1)`,
        [[orgAId, orgBId]],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractAId]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectAId, projectBId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [userAId, userBId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgAId, orgBId],
      ]);
      await moduleRef.close();
    }
  });

  // ─── Happy path: create → list → getOne → update → delete ────────────────

  describe('CRUD happy path', () => {
    it('creates, reads back, updates, and deletes a position', async () => {
      const created = await service.create(orgAId, userAId, rangeDto());
      expect(created.id).toBeDefined();
      expect(created.organization_id).toBe(orgAId);
      expect(created.scope).toBe(PlaybookScope.ORG);
      expect(created.created_by).toBe(userAId);
      expect(created.is_active).toBe(true);
      expect(created.is_custom_clause_type).toBe(false);

      // Re-read FROM POSTGRES, not the in-memory object — proves the jsonb
      // round-tripped rather than merely echoing what we passed in.
      const fetched = await service.getOne(orgAId, created.id);
      expect(fetched.value_config).toEqual({ min: 28, max: 45, unit: 'days' });
      expect(fetched.clause_type).toBe('payment');
      expect(fetched.rule_type).toBe(PlaybookRuleType.RANGE);

      const listed = await service.list(orgAId);
      expect(listed.map((r) => r.id)).toContain(created.id);

      const updated = await service.update(orgAId, created.id, {
        note: 'our standard net-30',
        is_active: false,
      });
      expect(updated.note).toBe('our standard net-30');
      expect(updated.is_active).toBe(false);
      // Untouched fields survive the patch.
      expect(updated.value_config).toEqual({ min: 28, max: 45, unit: 'days' });

      await service.remove(orgAId, created.id);
      await expect(service.getOne(orgAId, created.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('round-trips every rule_type through jsonb', async () => {
      const cases: Array<[PlaybookRuleType, Record<string, unknown>]> = [
        [PlaybookRuleType.RANGE, { min: 28, max: 45, unit: 'days' }],
        [
          PlaybookRuleType.THRESHOLD,
          {
            direction: PlaybookThresholdDirection.AT_MOST,
            value: 10,
            unit: 'percent',
          },
        ],
        [PlaybookRuleType.ENUM, { allowed: ['ICC Arbitration', 'LCIA'] }],
        [PlaybookRuleType.REQUIRED, { required: true }],
        // Arabic — 7.22 requires Arabic playbook definitions.
        [PlaybookRuleType.TEXT, { text: 'القانون المصري هو القانون الحاكم' }],
      ];

      for (const [rule_type, value_config] of cases) {
        const row = await service.create(orgAId, userAId, {
          clause_type: `rt_${rule_type}`,
          rule_type,
          value_config,
        });
        const back = await service.getOne(orgAId, row.id);
        expect(back.value_config).toEqual(value_config);
        await service.remove(orgAId, row.id);
      }
    });

    it('persists a PROJECT- and a CONTRACT-scoped position', async () => {
      const proj = await service.create(orgAId, userAId, {
        ...rangeDto(),
        scope: PlaybookScope.PROJECT,
        project_id: projectAId,
      });
      expect((await service.getOne(orgAId, proj.id)).project_id).toBe(projectAId);

      const con = await service.create(orgAId, userAId, {
        ...rangeDto(),
        scope: PlaybookScope.CONTRACT,
        contract_id: contractAId,
      });
      expect((await service.getOne(orgAId, con.id)).contract_id).toBe(contractAId);

      await service.remove(orgAId, proj.id);
      await service.remove(orgAId, con.id);
    });

    it('stores a custom clause_type verbatim (no backend allowlist)', async () => {
      const row = await service.create(orgAId, userAId, {
        clause_type: 'liquidated_damages_cap_custom',
        is_custom_clause_type: true,
        rule_type: PlaybookRuleType.TEXT,
        value_config: { text: 'LDs capped at 10% of contract value' },
      });
      const back = await service.getOne(orgAId, row.id);
      expect(back.clause_type).toBe('liquidated_damages_cap_custom');
      expect(back.is_custom_clause_type).toBe(true);
      await service.remove(orgAId, row.id);
    });
  });

  // ─── THE ORG WALL ────────────────────────────────────────────────────────

  describe('org wall — org A can never see or modify org B', () => {
    let bRowId: string;

    beforeEach(async () => {
      const row = await service.create(orgBId, userBId, {
        ...rangeDto(),
        clause_type: 'org_b_secret_position',
      });
      bRowId = row.id;
    });

    afterEach(async () => {
      await dataSource.query(`DELETE FROM playbook_positions WHERE id = $1`, [
        bRowId,
      ]);
    });

    it('getOne on another org’s id returns 404, NOT 403 (no existence leak)', async () => {
      await expect(service.getOne(orgAId, bRowId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('list never returns another org’s rows', async () => {
      const listed = await service.list(orgAId);
      expect(listed.map((r) => r.id)).not.toContain(bRowId);
      expect(
        listed.every((r) => r.organization_id === orgAId),
      ).toBe(true);
      // Sentinel: org B's clause_type must not appear anywhere in org A's list.
      expect(
        listed.some((r) => r.clause_type === 'org_b_secret_position'),
      ).toBe(false);
    });

    it('update on another org’s id returns 404 AND leaves the row untouched', async () => {
      await expect(
        service.update(orgAId, bRowId, { note: 'tampered by org A' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The wall is only real if NOTHING was written.
      const [row] = await dataSource.query(
        `SELECT note, clause_type, organization_id FROM playbook_positions WHERE id = $1`,
        [bRowId],
      );
      expect(row.note).toBeNull();
      expect(row.clause_type).toBe('org_b_secret_position');
      expect(row.organization_id).toBe(orgBId);
    });

    it('remove on another org’s id returns 404 AND does NOT delete the row', async () => {
      await expect(service.remove(orgAId, bRowId)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const rows = await dataSource.query(
        `SELECT id FROM playbook_positions WHERE id = $1`,
        [bRowId],
      );
      expect(rows).toHaveLength(1);
    });

    it('org B still reads its own row normally (the wall is not a blanket deny)', async () => {
      const row = await service.getOne(orgBId, bRowId);
      expect(row.id).toBe(bRowId);
      expect(row.organization_id).toBe(orgBId);
    });
  });

  // ─── Service-layer validation the DTO structurally cannot do ─────────────

  describe('scope coherence (service is the single authority)', () => {
    it('rejects an ORG-scoped position carrying a project_id', async () => {
      await expect(
        service.create(orgAId, userAId, {
          ...rangeDto(),
          scope: PlaybookScope.ORG,
          project_id: projectAId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a PROJECT-scoped position with no project_id', async () => {
      await expect(
        service.create(orgAId, userAId, {
          ...rangeDto(),
          scope: PlaybookScope.PROJECT,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a CONTRACT-scoped position with no contract_id', async () => {
      await expect(
        service.create(orgAId, userAId, {
          ...rangeDto(),
          scope: PlaybookScope.CONTRACT,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a scope change that would orphan the narrowing column', async () => {
      const row = await service.create(orgAId, userAId, {
        ...rangeDto(),
        scope: PlaybookScope.PROJECT,
        project_id: projectAId,
      });
      // PROJECT → ORG while project_id is still set: incoherent.
      await expect(
        service.update(orgAId, row.id, { scope: PlaybookScope.ORG }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.remove(orgAId, row.id);
    });

    it('allows a coherent re-scope (PROJECT → ORG clearing project_id)', async () => {
      const row = await service.create(orgAId, userAId, {
        ...rangeDto(),
        scope: PlaybookScope.PROJECT,
        project_id: projectAId,
      });
      const updated = await service.update(orgAId, row.id, {
        scope: PlaybookScope.ORG,
        project_id: null,
      });
      expect(updated.scope).toBe(PlaybookScope.ORG);
      expect(updated.project_id).toBeNull();
      await service.remove(orgAId, row.id);
    });
  });

  describe('merged rule_type ↔ value_config pair on UPDATE', () => {
    it('rejects switching rule_type while the stored value_config no longer fits', async () => {
      // THE case the DTO structurally cannot catch: the patch carries only
      // rule_type, so only the service sees the resulting orphaned pair.
      const row = await service.create(orgAId, userAId, rangeDto());
      await expect(
        service.update(orgAId, row.id, { rule_type: PlaybookRuleType.TEXT }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Nothing was written.
      const back = await service.getOne(orgAId, row.id);
      expect(back.rule_type).toBe(PlaybookRuleType.RANGE);
      await service.remove(orgAId, row.id);
    });

    it('rejects a lone value_config that does not fit the STORED rule_type', async () => {
      const row = await service.create(orgAId, userAId, rangeDto());
      await expect(
        service.update(orgAId, row.id, {
          value_config: { text: 'a TEXT config under a RANGE row' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.remove(orgAId, row.id);
    });

    it('accepts a coherent simultaneous switch of BOTH halves', async () => {
      const row = await service.create(orgAId, userAId, rangeDto());
      const updated = await service.update(orgAId, row.id, {
        rule_type: PlaybookRuleType.THRESHOLD,
        value_config: {
          direction: PlaybookThresholdDirection.AT_MOST,
          value: 10,
          unit: 'percent',
        },
      });
      expect(updated.rule_type).toBe(PlaybookRuleType.THRESHOLD);
      expect((await service.getOne(orgAId, row.id)).value_config).toEqual({
        direction: 'AT_MOST',
        value: 10,
        unit: 'percent',
      });
      await service.remove(orgAId, row.id);
    });

    it('rejects a malformed value_config on create at the service seam too', async () => {
      // Direct (non-HTTP) callers bypass the ValidationPipe entirely.
      await expect(
        service.create(orgAId, userAId, {
          clause_type: 'payment',
          rule_type: PlaybookRuleType.RANGE,
          value_config: { max: 45, unit: 'days' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── DB-level guarantees ────────────────────────────────────────────────

  describe('database constraints', () => {
    it('CASCADEs positions when their organization is deleted', async () => {
      const tmpOrg = randomUUID();
      await dataSource.query(
        `INSERT INTO organizations (id, name) VALUES ($1,'pb-org-tmp')`,
        [tmpOrg],
      );
      const row = await service.create(tmpOrg, null, rangeDto());
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [tmpOrg]);
      const rows = await dataSource.query(
        `SELECT id FROM playbook_positions WHERE id = $1`,
        [row.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('SET NULLs created_by when the authoring user is deleted, keeping the position', async () => {
      const tmpUser = randomUUID();
      await insertUser(tmpUser, orgAId);
      const row = await service.create(orgAId, tmpUser, rangeDto());
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [tmpUser]);

      const back = await service.getOne(orgAId, row.id);
      expect(back.created_by).toBeNull();
      expect(back.clause_type).toBe('payment');
      await service.remove(orgAId, row.id);
    });

    it('rejects an out-of-allowlist rule_type at the DB CHECK', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO playbook_positions (organization_id, clause_type, rule_type, value_config)
           VALUES ($1,'payment','NOT_A_RULE','{}'::jsonb)`,
          [orgAId],
        ),
      ).rejects.toThrow(/playbook_positions_rule_type_check/);
    });

    it('rejects an incoherent scope at the DB CHECK (backstop below the service)', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO playbook_positions (organization_id, scope, clause_type, rule_type, value_config)
           VALUES ($1,'PROJECT','payment','TEXT','{"text":"x"}'::jsonb)`,
          [orgAId],
        ),
      ).rejects.toThrow(/playbook_positions_scope_coherence_check/);
    });
  });
});
