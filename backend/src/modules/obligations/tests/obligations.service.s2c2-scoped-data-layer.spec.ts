import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Real Postgres required (DATABASE_URL): the destructive probe below must
// prove against a LIVE schema that a cross-org DELETE leaves the foreign row
// physically intact when only the #60 wall is bypassed — a mock cannot prove
// a row survived. CI is unit-test ONLY (CLAUDE.md); a silent skip would read
// green without proving the S2c-2 data-layer gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[obligations] SKIPPING real-Postgres specs ' +
      '(obligations.service.s2c2-scoped-data-layer.spec.ts): DATABASE_URL ' +
      'unset — these MUST run in an environment with Postgres (dev/staging). ' +
      'CI green here does NOT prove the Option B S2c-2 destructive-path gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Obligation } from '../../../database/entities';
import { ScopedRepositoryModule } from '../../scoped-repository/scoped-repository.module';
import { ObligationScopedRepository } from '../../scoped-repository/obligation-scoped.repository';
import { ObligationsService } from '../obligations.service';

/**
 * Option B — S2c-2: REAL-POSTGRES proof that the by-id MUTATION surface of
 * ObligationsService denies cross-tenant access at the DATA layer, with the
 * #60 wall deliberately NEUTRALIZED (findInOrg always resolves — simulating
 * a wall bug or bypass).
 *
 * The headline probe is DESTRUCTIVE-path: an org-A caller deleting an org-B
 * obligation. Pre-wire, the red run of this spec genuinely DELETED the
 * foreign fixture row from Postgres (the bare findOne loaded it; the
 * neutralized wall waved it through; repo.remove() executed). Post-wire, the
 * scoped chokepoint 404s and the row is proven still present by a direct
 * SQL count.
 *
 * The service is constructed through an `any`-cast (real repo + real scoped
 * repo + noop wall) so the spec RUNS against the pre-wire 2-arg constructor.
 */
describeReal('Option B S2c-2 — ObligationsService data-layer gate (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let obligationRepo: Repository<Obligation>;
  let obligationScoped: ObligationScopedRepository;
  let svc: ObligationsService;

  // #60 wall NEUTRALIZED — the data layer must deny alone.
  const neutralizedWall = { findInOrg: jest.fn().mockResolvedValue({}) };

  // Fixture refs — two orgs, a contract and an obligation each.
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID();
  const contractB = randomUUID();
  const obligationA = randomUUID(); // org A's — the in-org control
  const obligationB = randomUUID(); // org B's — the foreign target

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        ScopedRepositoryModule,
        TypeOrmModule.forFeature([Obligation]),
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    obligationRepo = moduleRef.get(getRepositoryToken(Obligation));
    obligationScoped = moduleRef.get(ObligationScopedRepository);

    // Real repo + neutralized wall + real scoped repo. `any`-cast so the
    // pre-wire (2-arg) constructor still runs — true runtime red.
    const Ctor: any = ObligationsService;
    svc = new Ctor(obligationRepo, neutralizedWall, obligationScoped);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `s2c2-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2c2', 'DataLayerTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2c2-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2c2.repo.test.x',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2c2-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2c2-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    await dataSource.query(
      `INSERT INTO obligations (id, contract_id, project_id, description)
       VALUES ($1, $2, $3, 's2c2 obligation A'), ($4, $5, $6, 's2c2 obligation B')`,
      [obligationA, contractA, projectA, obligationB, contractB, projectB],
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM obligations WHERE id IN ($1,$2)`, [
      obligationA,
      obligationB,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  const countObligation = async (id: string): Promise<number> => {
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS n FROM obligations WHERE id = $1`,
      [id],
    );
    return rows[0].n;
  };

  // ── Cross-org probes, wall NEUTRALIZED — read → write → DESTRUCTIVE.
  //    (Ordered so the pre-wire red run hit each probe on an intact fixture
  //    before the destructive one removed it.) ───────────────────────────────

  it('cross-org findById, wall NEUTRALIZED → 404 (scoped chokepoint denies alone)', async () => {
    await expect(svc.findById(obligationB, orgA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cross-org update, wall NEUTRALIZED → 404 and the foreign row is unmodified', async () => {
    await expect(
      svc.update(obligationB, { description: 'hijacked' } as any, orgA),
    ).rejects.toBeInstanceOf(NotFoundException);

    const rows = await dataSource.query(
      `SELECT description FROM obligations WHERE id = $1`,
      [obligationB],
    );
    expect(rows[0].description).toBe('s2c2 obligation B');
  });

  it('DESTRUCTIVE: org-A delete of org-B obligation, wall NEUTRALIZED → 404 and the foreign row is STILL IN THE DATABASE', async () => {
    await expect(svc.delete(obligationB, orgA)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // The decisive assertion: the foreign row physically survived.
    await expect(countObligation(obligationB)).resolves.toBe(1);
  });

  // ── In-org control (the gate does not over-deny) ─────────────────────────

  it('in-org findById resolves and hydrates relations', async () => {
    const row = await svc.findById(obligationA, orgA);
    expect(row.id).toBe(obligationA);
  });

  it('in-org findByContract two-step returns the org-safe hydrated rows', async () => {
    const rows = await svc.findByContract(contractA, orgA);
    expect(rows.map((r) => r.id)).toEqual([obligationA]);
  });

  it('cross-org findByContract, wall NEUTRALIZED → empty (scoped list denies alone)', async () => {
    const rows = await svc.findByContract(contractB, orgA);
    expect(rows).toEqual([]);
  });

  // ── In-org delete still works (run LAST — it removes the A fixture) ──────

  it('in-org delete removes the row through the scoped chokepoint', async () => {
    await expect(svc.delete(obligationA, orgA)).resolves.toBeUndefined();
    await expect(countObligation(obligationA)).resolves.toBe(0);
  });
});
