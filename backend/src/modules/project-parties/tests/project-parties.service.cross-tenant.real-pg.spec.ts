import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import { ProjectPartiesService } from '../project-parties.service';
import {
  ProjectParty,
  PartyType,
  Project,
  Organization,
  User,
  UserRole,
} from '../../../database/entities';

/**
 * Cross-tenant leak fix — ProjectPartiesService org-scoped methods (real Postgres).
 *
 * The bug (same footgun as projects #228/#229): findById and update loaded the party
 * with the find-options `where: { id, owner_organization_id: orgId }`, and create
 * gated the target project with `where: { id, organization_id: orgId }`. TypeORM 0.3.x
 * DROPS a null value from a find-options where, so a null-org principal (a guest —
 * org=null — reaching a no-@Roles /project-parties route) got ANY party by id
 * cross-org (findById READ), could OVERWRITE a foreign party (update WRITE), and
 * bypassed create's project-ownership check (create's insert then died on the
 * owner_organization_id NOT-NULL constraint → a 500 existence-oracle instead of a
 * clean 404).
 *
 * The fix: every org-scoped load is a QueryBuilder that BINDS the org column
 * (`.andWhere('party.owner_organization_id = :orgId', { orgId })` /
 * `.andWhere('project.organization_id = :orgId', { orgId })`) → a null orgId compiles
 * to `= NULL` → matches nothing → NotFound BEFORE any read / write / insert.
 *
 * For update the tests assert DATA STATE (the foreign row is unchanged), not just the
 * throw — a read failing closed is not enough for a write. For create the tests assert
 * NO party row was created (no orphan/partial insert). Dedicated destructive-target
 * rows (PUA legit / PUB assert-unchanged) keep the checks isolated; each jest run
 * re-seeds via beforeAll, so runs are independent.
 *
 * Sites 4/5/6 (invite — @Roles(OWNER_ADMIN, OWNER_CREATOR)-gated, not guest-reachable;
 * getByProject — no HTTP route) are out of scope and untouched.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[project-parties.cross-tenant] SKIPPING real-Postgres spec: DATABASE_URL unset. ' +
      'This MUST run against Postgres to prove the tenancy boundary. CI green here ' +
      'does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('ProjectPartiesService — cross-tenant leak fix (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let partyRepo: Repository<ProjectParty>;
  let projectRepo: Repository<Project>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let service: ProjectPartiesService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const projectAId = randomUUID();
  const projectBId = randomUUID();

  // Read fixtures.
  const PA = randomUUID(); // org A — read/legit target
  const PB = randomUUID(); // org B — cross-org/null READ target (non-destructive)
  // Dedicated update targets (isolated so the mutation-check can't corrupt reads).
  const PUA = randomUUID(); // org A — legit update target
  const PUB = randomUUID(); // org B — cross-org/null UPDATE target (assert unchanged)
  const allParties = [PA, PB, PUA, PUB];

  // Sentinel names for the create-leak assertions (must never persist).
  const CREATE_LEAK_NULL = `create-leak-null-${randomUUID().slice(0, 8)}`;
  const CREATE_LEAK_XORG = `create-leak-xorg-${randomUUID().slice(0, 8)}`;
  const CREATE_LEGIT = `create-legit-${randomUUID().slice(0, 8)}`;

  const seedUser = (id: string, orgId: string, label: string) =>
    userRepo.save(
      userRepo.create({
        id,
        email: `xtenant-pp-${label}-${id.slice(0, 8)}@example.test`,
        password_hash: 'x',
        first_name: label,
        last_name: 'X',
        role: UserRole.OWNER_ADMIN,
        organization_id: orgId,
      }),
    );

  const seedProject = (id: string, orgId: string, createdBy: string, label: string) =>
    projectRepo.save(
      projectRepo.create({
        id,
        organization_id: orgId,
        name: `xtenant-pp-${label}-${id.slice(0, 8)}`,
        created_by: createdBy,
      }),
    );

  const partyName = (label: string, id: string) => `xtenant-pp-${label}-${id.slice(0, 8)}`;

  const seedParty = (id: string, projectId: string, orgId: string, label: string) =>
    partyRepo.save(
      partyRepo.create({
        id,
        project_id: projectId,
        owner_organization_id: orgId,
        party_type: PartyType.CONTRACTOR,
        name: partyName(label, id),
        email: `party-${label}-${id.slice(0, 8)}@example.test`,
      }),
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
    partyRepo = dataSource.getRepository(ProjectParty);
    projectRepo = dataSource.getRepository(Project);
    orgRepo = dataSource.getRepository(Organization);
    userRepo = dataSource.getRepository(User);

    // Real repos for the two repos the tested methods touch; emailService is stubbed
    // (only invite() calls it, and invite is out of scope here).
    service = new ProjectPartiesService(
      partyRepo,
      projectRepo,
      {} as any, // emailService
    );

    await orgRepo.save(orgRepo.create({ id: orgAId, name: `xtenant-pp-A-${orgAId.slice(0, 8)}` }));
    await orgRepo.save(orgRepo.create({ id: orgBId, name: `xtenant-pp-B-${orgBId.slice(0, 8)}` }));
    await seedUser(userAId, orgAId, 'A');
    await seedUser(userBId, orgBId, 'B');
    await seedProject(projectAId, orgAId, userAId, 'projA');
    await seedProject(projectBId, orgBId, userBId, 'projB');
    await seedParty(PA, projectAId, orgAId, 'PA');
    await seedParty(PB, projectBId, orgBId, 'PB');
    await seedParty(PUA, projectAId, orgAId, 'PUA');
    await seedParty(PUB, projectBId, orgBId, 'PUB');
  });

  afterAll(async () => {
    // Delete any create-leak / legit-created rows first (by sentinel name), then fixtures.
    await partyRepo.delete({ name: CREATE_LEGIT });
    await partyRepo.delete({ name: CREATE_LEAK_NULL });
    await partyRepo.delete({ name: CREATE_LEAK_XORG });
    await partyRepo.delete(allParties); // missing ids are ignored
    await projectRepo.delete([projectAId, projectBId]);
    await userRepo.delete([userAId, userBId]);
    await orgRepo.delete([orgAId, orgBId]);
    await moduleRef?.close();
  });

  // ─── findById (READ) ───────────────────────────────────────────────────────
  describe('findById', () => {
    it('LEGIT same-org returns PA with the project relation hydrated', async () => {
      const p = await service.findById(PA, orgAId);
      expect(p.id).toBe(PA);
      expect(p.project?.id).toBe(projectAId);
    });
    it('CROSS-ORG → NotFound', async () => {
      await expect(service.findById(PB, orgAId)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('NULL-ORG (leak input) → NotFound', async () => {
      await expect(service.findById(PB, null as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── update (WRITE — assert the foreign row is NOT mutated) ─────────────────
  describe('update', () => {
    it('LEGIT same-org updates the party', async () => {
      const r = await service.update(PUA, orgAId, { name: 'legit-renamed' } as any);
      expect(r.name).toBe('legit-renamed');
    });
    it('CROSS-ORG → NotFound and the foreign row is UNCHANGED', async () => {
      await expect(
        service.update(PUB, orgAId, { name: 'HACKED' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const after = await partyRepo.findOne({ where: { id: PUB } });
      expect(after?.name).toBe(partyName('PUB', PUB)); // no write leaked through
    });
    it('NULL-ORG (leak input) → NotFound and the foreign row is UNCHANGED', async () => {
      await expect(
        service.update(PUB, null as any, { name: 'HACKED' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const after = await partyRepo.findOne({ where: { id: PUB } });
      expect(after?.name).toBe(partyName('PUB', PUB));
    });
  });

  // ─── create (project-ownership gate — assert NO orphan/partial insert) ──────
  describe('create', () => {
    const dtoFor = (name: string) => ({
      project_id: projectBId, // org B's project
      party_type: PartyType.CONTRACTOR,
      name,
      email: `${name}@example.test`,
    });

    it('LEGIT same-org (B→projectB) creates the party', async () => {
      const r = await service.create(orgBId, dtoFor(CREATE_LEGIT) as any);
      expect(r.id).toBeDefined();
      expect(r.owner_organization_id).toBe(orgBId);
    });
    it('CROSS-ORG (A→projectB) → NotFound and NO party row created', async () => {
      await expect(
        service.create(orgAId, dtoFor(CREATE_LEAK_XORG) as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const orphan = await partyRepo.findOne({ where: { name: CREATE_LEAK_XORG } });
      expect(orphan).toBeNull();
    });
    it('NULL-ORG (leak input, null→projectB) → NotFound and NO party row created', async () => {
      await expect(
        service.create(null as any, dtoFor(CREATE_LEAK_NULL) as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const orphan = await partyRepo.findOne({ where: { name: CREATE_LEAK_NULL } });
      expect(orphan).toBeNull();
    });
  });
});
