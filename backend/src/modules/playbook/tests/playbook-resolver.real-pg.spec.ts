import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookScope,
} from '../../../database/entities';
import { PlaybookResolverService } from '../playbook-resolver.service';
import { PlaybookService } from '../playbook.service';

/**
 * 7.22 Slice 2 — PlaybookResolverService against REAL Postgres.
 *
 * Real PG for the same reasons Slice 1's spec gives: the ORG WALL is a tenancy
 * invariant a mocked repo cannot prove (lesson #140), and the precedence fold
 * runs on rows that must actually satisfy the DB's scope-coherence CHECK — a
 * mock would happily hand back a scope='PROJECT'/project_id=NULL row that
 * Postgres forbids, so the fold would be tested against states that cannot
 * exist.
 *
 * MUST run IN-CONTAINER: the host's native Postgres shadows localhost:5432.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[playbook-resolver] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the org wall and the ' +
      'scope-precedence fold over real rows.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('PlaybookResolverService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let resolver: PlaybookResolverService;
  let service: PlaybookService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const projectAId = randomUUID();
  const projectA2Id = randomUUID();
  const projectBId = randomUUID();

  // Contract 1 and 2 live in project A; contract 3 lives in project A2.
  let contract1Id: string;
  let contract2Id: string;
  let contract3Id: string;

  const insertUser = (id: string, org: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Playbook','Resolver','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `pbr-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.pbr', org],
    );

  const insertContract = (id: string, projectId: string, user: string) =>
    dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by, status,
                              party_first_name, party_second_name)
       VALUES ($1,$2,'PBR Contract','FIDIC_RED_BOOK_2017',$3,'DRAFT','A','B')`,
      [id, projectId, user],
    );

  /** Clear this org's positions between cases so each test states its own world. */
  const clearPositions = () =>
    dataSource.query(
      `DELETE FROM playbook_positions WHERE organization_id = ANY($1)`,
      [[orgAId, orgBId]],
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
    const repo = dataSource.getRepository(PlaybookPosition);
    resolver = new PlaybookResolverService(repo);
    service = new PlaybookService(repo);

    for (const [id, name] of [
      [orgAId, 'pbr-org-A'],
      [orgBId, 'pbr-org-B'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO organizations (id, name) VALUES ($1,$2)`,
        [id, name],
      );
    }
    await insertUser(userAId, orgAId);
    await insertUser(userBId, orgBId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pbr-project-A',$3)`,
      [projectAId, orgAId, userAId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pbr-project-A2',$3)`,
      [projectA2Id, orgAId, userAId],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pbr-project-B',$3)`,
      [projectBId, orgBId, userBId],
    );

    contract1Id = randomUUID();
    contract2Id = randomUUID();
    contract3Id = randomUUID();
    await insertContract(contract1Id, projectAId, userAId);
    await insertContract(contract2Id, projectAId, userAId);
    await insertContract(contract3Id, projectA2Id, userAId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clearPositions();
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contract1Id, contract2Id, contract3Id],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectAId, projectA2Id, projectBId],
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

  beforeEach(clearPositions);

  // ─── The headline precedence case ────────────────────────────────────────

  describe('scope precedence — CONTRACT > PROJECT > ORG', () => {
    /**
     * The world under test, all on clause_type 'payment':
     *   ORG      → 28–45 days   (org A default)
     *   PROJECT  → 30–60 days   (project A)
     *   CONTRACT → 14–21 days   (contract 1, which lives in project A)
     */
    const seedThreeTiers = async () => {
      const org = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });
      const project = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        scope: PlaybookScope.PROJECT,
        project_id: projectAId,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 30, max: 60, unit: 'days' },
      });
      const contract = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        scope: PlaybookScope.CONTRACT,
        contract_id: contract1Id,
        project_id: projectAId,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 14, max: 21, unit: 'days' },
      });
      return { org, project, contract };
    };

    it('returns ONLY the contract override for the overridden contract', async () => {
      const { contract } = await seedThreeTiers();

      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        projectId: projectAId,
        contractId: contract1Id,
      });

      const payment = resolved.filter((p) => p.clause_type === 'payment');
      expect(payment).toHaveLength(1);
      expect(payment[0].id).toBe(contract.id);
      expect(payment[0].scope).toBe(PlaybookScope.CONTRACT);
      expect(payment[0].value_config).toEqual({
        min: 14,
        max: 21,
        unit: 'days',
      });
    });

    it('returns the PROJECT position for a different contract in that project', async () => {
      const { project } = await seedThreeTiers();

      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        projectId: projectAId,
        contractId: contract2Id, // same project, no contract override
      });

      const payment = resolved.filter((p) => p.clause_type === 'payment');
      expect(payment).toHaveLength(1);
      expect(payment[0].id).toBe(project.id);
      expect(payment[0].scope).toBe(PlaybookScope.PROJECT);
      expect(payment[0].value_config).toEqual({
        min: 30,
        max: 60,
        unit: 'days',
      });
    });

    it('returns the ORG default for a contract in a different project', async () => {
      const { org } = await seedThreeTiers();

      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        projectId: projectA2Id,
        contractId: contract3Id,
      });

      const payment = resolved.filter((p) => p.clause_type === 'payment');
      expect(payment).toHaveLength(1);
      expect(payment[0].id).toBe(org.id);
      expect(payment[0].scope).toBe(PlaybookScope.ORG);
      expect(payment[0].value_config).toEqual({
        min: 28,
        max: 45,
        unit: 'days',
      });
    });

    it('returns the ORG default when no narrowing target is supplied at all', async () => {
      const { org } = await seedThreeTiers();

      const resolved = await resolver.resolveEffectivePositions(orgAId);

      const payment = resolved.filter((p) => p.clause_type === 'payment');
      expect(payment).toHaveLength(1);
      expect(payment[0].id).toBe(org.id);
    });
  });

  // ─── The full sheet, not a partial one ───────────────────────────────────

  it('substitutes overrides into the ORG sheet without dropping un-overridden types', async () => {
    const orgPayment = await service.create(orgAId, userAId, {
      clause_type: 'payment',
      rule_type: PlaybookRuleType.RANGE,
      value_config: { min: 28, max: 45, unit: 'days' },
    });
    const orgRetention = await service.create(orgAId, userAId, {
      clause_type: 'retention',
      rule_type: PlaybookRuleType.THRESHOLD,
      value_config: { direction: 'AT_MOST', value: 10, unit: 'percent' },
    });
    const contractPayment = await service.create(orgAId, userAId, {
      clause_type: 'payment',
      scope: PlaybookScope.CONTRACT,
      contract_id: contract1Id,
      rule_type: PlaybookRuleType.RANGE,
      value_config: { min: 14, max: 21, unit: 'days' },
    });

    const resolved = await resolver.resolveEffectivePositions(orgAId, {
      projectId: projectAId,
      contractId: contract1Id,
    });

    // Exactly one row per clause type: the override for payment, the org
    // default for retention. The un-overridden type is NOT lost.
    expect(resolved.map((p) => p.id).sort()).toEqual(
      [contractPayment.id, orgRetention.id].sort(),
    );
    expect(resolved).toHaveLength(2);
    expect(resolved.map((p) => p.id)).not.toContain(orgPayment.id);
  });

  it('allows an override to change rule_type outright (whole-position replacement)', async () => {
    await service.create(orgAId, userAId, {
      clause_type: 'governing_law',
      rule_type: PlaybookRuleType.ENUM,
      value_config: { allowed: ['Egyptian law', 'English law'] },
    });
    const override = await service.create(orgAId, userAId, {
      clause_type: 'governing_law',
      scope: PlaybookScope.CONTRACT,
      contract_id: contract1Id,
      rule_type: PlaybookRuleType.TEXT,
      value_config: { text: 'القانون المصري هو القانون الحاكم' },
    });

    const resolved = await resolver.resolveEffectivePositions(orgAId, {
      contractId: contract1Id,
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(override.id);
    expect(resolved[0].rule_type).toBe(PlaybookRuleType.TEXT);
    // No field-merge: the org's ENUM `allowed` list is gone, not blended in.
    expect(resolved[0].value_config).toEqual({
      text: 'القانون المصري هو القانون الحاكم',
    });
  });

  // ─── The wall ────────────────────────────────────────────────────────────

  describe('org wall', () => {
    it('never returns another org\'s positions', async () => {
      await service.create(orgBId, userBId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 1, max: 7, unit: 'days' },
      });

      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        projectId: projectAId,
        contractId: contract1Id,
      });

      expect(resolved).toEqual([]);
    });

    it('a foreign project/contract id resolves to this org\'s defaults, leaking nothing', async () => {
      const orgDefault = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });
      // Org B narrows the SAME clause type onto its own project.
      await service.create(orgBId, userBId, {
        clause_type: 'payment',
        scope: PlaybookScope.PROJECT,
        project_id: projectBId,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 1, max: 7, unit: 'days' },
      });

      // Org A asks about ORG B's project id — a narrowing predicate is not a
      // tenancy root, so this must fall through to org A's own default.
      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        projectId: projectBId,
      });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe(orgDefault.id);
      expect(resolved[0].organization_id).toBe(orgAId);
    });

    it('returns [] for an empty orgId rather than resolving unscoped', async () => {
      await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });

      expect(await resolver.resolveEffectivePositions('')).toEqual([]);
    });
  });

  // ─── is_active ───────────────────────────────────────────────────────────

  describe('inactive positions', () => {
    it('excludes an inactive ORG position entirely', async () => {
      await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
        is_active: false,
      });

      expect(await resolver.resolveEffectivePositions(orgAId)).toEqual([]);
    });

    it('deactivating a CONTRACT override UNCOVERS the ORG default', async () => {
      const orgDefault = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });
      const override = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        scope: PlaybookScope.CONTRACT,
        contract_id: contract1Id,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 14, max: 21, unit: 'days' },
      });

      const before = await resolver.resolveEffectivePositions(orgAId, {
        contractId: contract1Id,
      });
      expect(before.map((p) => p.id)).toEqual([override.id]);

      await service.update(orgAId, override.id, { is_active: false });

      const after = await resolver.resolveEffectivePositions(orgAId, {
        contractId: contract1Id,
      });
      expect(after.map((p) => p.id)).toEqual([orgDefault.id]);
    });
  });

  // ─── Determinism ─────────────────────────────────────────────────────────

  describe('determinism', () => {
    it('collides clause types case- and whitespace-insensitively', async () => {
      await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });
      const override = await service.create(orgAId, userAId, {
        // Same subject, differently cased/padded by whoever authored it.
        clause_type: '  Payment ',
        scope: PlaybookScope.CONTRACT,
        contract_id: contract1Id,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 14, max: 21, unit: 'days' },
      });

      const resolved = await resolver.resolveEffectivePositions(orgAId, {
        contractId: contract1Id,
      });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe(override.id);
      // The winner's ORIGINAL string is preserved — only the key is normalized.
      expect(resolved[0].clause_type).toBe('  Payment ');
    });

    it('orders results stably by clause type across repeated calls', async () => {
      for (const clause_type of ['retention', 'payment', 'liability']) {
        await service.create(orgAId, userAId, {
          clause_type,
          rule_type: PlaybookRuleType.REQUIRED,
          value_config: { required: true },
        });
      }

      const first = await resolver.resolveEffectivePositions(orgAId);
      const second = await resolver.resolveEffectivePositions(orgAId);

      expect(first.map((p) => p.clause_type)).toEqual([
        'liability',
        'payment',
        'retention',
      ]);
      expect(second.map((p) => p.clause_type)).toEqual(
        first.map((p) => p.clause_type),
      );
    });

    it('resolves same-tier duplicates to the most recently updated row', async () => {
      const older = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      });
      const newer = await service.create(orgAId, userAId, {
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 30, max: 60, unit: 'days' },
      });
      // Touch `newer` so its updated_at is unambiguously the latest.
      await service.update(orgAId, newer.id, { note: 'supersedes the first' });

      const resolved = await resolver.resolveEffectivePositions(orgAId);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe(newer.id);
      expect(resolved.map((p) => p.id)).not.toContain(older.id);
    });
  });
});
