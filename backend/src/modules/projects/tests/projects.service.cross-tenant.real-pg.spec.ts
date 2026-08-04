import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../projects.service';
import {
  Project,
  Organization,
  User,
  UserRole,
  ProjectMember,
  Contract,
  ProjectParty,
  RiskAnalysis,
} from '../../../database/entities';

/**
 * Cross-tenant leak fix — ProjectsService org-scoped methods (real Postgres).
 *
 * The bug: findById AND its siblings (update, getDashboard, getMembers,
 * deleteProject) loaded the project with the find-options
 * `where: { id, organization_id: orgId }`. TypeORM 0.3.x DROPS a null value from
 * a find-options where, so a null-org principal (a guest — org=null — reaching a
 * no-@Roles /projects route) got ANY project by id, cross-org. findById was fixed
 * in #228; the four siblings share the identical footgun — and update/deleteProject
 * are WRITES/DELETES (worse: a null-org caller could overwrite/delete a foreign
 * project).
 *
 * The fix: every project load is a QueryBuilder that BINDS organization_id
 * (`.andWhere('project.organization_id = :orgId', { orgId })`) → a null orgId
 * compiles to `= NULL` → matches nothing → NotFound BEFORE any read/write/delete.
 *
 * For update/deleteProject the tests assert DATA STATE (the foreign row is
 * unchanged / still exists), not just the throw — a read failing closed is not
 * enough for a write. Dedicated destructive-target rows keep the mutation-check
 * (which really writes/deletes in the RED state) from corrupting the read fixtures;
 * each jest run re-seeds via beforeAll, so runs are independent.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[projects.cross-tenant] SKIPPING real-Postgres spec: DATABASE_URL unset. ' +
      'This MUST run against Postgres to prove the tenancy boundary. CI green ' +
      'here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('ProjectsService — cross-tenant leak fix (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let projectRepo: Repository<Project>;
  let memberRepo: Repository<ProjectMember>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let service: ProjectsService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID(); // creator + member in org A
  const userBId = randomUUID(); // creator in org B

  // Read fixtures.
  const PA = randomUUID(); // org A — read/legit target
  const PB = randomUUID(); // org B — cross-org/null READ target (non-destructive)
  // Dedicated destructive targets (isolated so the mutation-check can't corrupt reads).
  const PUA = randomUUID(); // org A — legit update target
  const PUB = randomUUID(); // org B — cross-org/null UPDATE target (assert unchanged)
  const PDA = randomUUID(); // org A — legit delete target
  const PDB = randomUUID(); // org B — cross-org/null DELETE target (assert survives)
  const allProjects = [PA, PB, PUA, PUB, PDA, PDB];

  const seedUser = (id: string, orgId: string, label: string) =>
    userRepo.save(
      userRepo.create({
        id,
        email: `xtenant-${label}-${id.slice(0, 8)}@example.test`,
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
        name: `xtenant-${label}-${id.slice(0, 8)}`,
        created_by: createdBy,
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
    projectRepo = dataSource.getRepository(Project);
    memberRepo = dataSource.getRepository(ProjectMember);
    orgRepo = dataSource.getRepository(Organization);
    userRepo = dataSource.getRepository(User);

    // Real repos for the 5 constructor repos the tested methods touch (getDashboard
    // aggregates run against empty tables → zero counts); partyRoles is stubbed
    // (only create()/update() call it, and only when default_party_role_code is set,
    // which these tests never do).
    service = new ProjectsService(
      projectRepo,
      memberRepo,
      dataSource.getRepository(Contract),
      dataSource.getRepository(ProjectParty),
      dataSource.getRepository(RiskAnalysis),
      {} as any, // partyRoles
    );

    await orgRepo.save(orgRepo.create({ id: orgAId, name: `xtenant-A-${orgAId.slice(0, 8)}` }));
    await orgRepo.save(orgRepo.create({ id: orgBId, name: `xtenant-B-${orgBId.slice(0, 8)}` }));
    await seedUser(userAId, orgAId, 'A');
    await seedUser(userBId, orgBId, 'B');
    await seedProject(PA, orgAId, userAId, 'PA');
    await seedProject(PB, orgBId, userBId, 'PB');
    await seedProject(PUA, orgAId, userAId, 'PUA');
    await seedProject(PUB, orgBId, userBId, 'PUB');
    await seedProject(PDA, orgAId, userAId, 'PDA');
    await seedProject(PDB, orgBId, userBId, 'PDB');
    // One member on PA (getMembers legit).
    await memberRepo.save(
      memberRepo.create({ project_id: PA, user_id: userAId, role: 'MEMBER' }),
    );
  });

  afterAll(async () => {
    await memberRepo.delete({ project_id: PA });
    await projectRepo.delete(allProjects); // missing ids (deleted in tests) are ignored
    await userRepo.delete([userAId, userBId]);
    await orgRepo.delete([orgAId, orgBId]);
    await moduleRef?.close();
  });

  // ─── findById (the #228 method) ────────────────────────────────────────────
  describe('findById', () => {
    it('LEGIT same-org returns PA with creator hydrated', async () => {
      const p = await service.findById(PA, orgAId);
      expect(p.id).toBe(PA);
      expect(p.creator?.id).toBe(userAId);
    });
    it('CROSS-ORG → NotFound', async () => {
      await expect(service.findById(PB, orgAId)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('NULL-ORG (leak input) → NotFound', async () => {
      await expect(service.findById(PB, null as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── getMembers (read) ─────────────────────────────────────────────────────
  describe('getMembers', () => {
    it('LEGIT same-org returns the member list', async () => {
      const members = await service.getMembers(PA, orgAId);
      expect(members.map((m) => m.user_id)).toContain(userAId);
    });
    it('CROSS-ORG → NotFound', async () => {
      await expect(service.getMembers(PB, orgAId)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('NULL-ORG (leak input) → NotFound', async () => {
      await expect(service.getMembers(PB, null as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── getDashboard (read) ───────────────────────────────────────────────────
  describe('getDashboard', () => {
    it('LEGIT same-org returns the dashboard', async () => {
      const d = await service.getDashboard(PA, orgAId);
      expect(d.project_id).toBe(PA);
    });
    it('CROSS-ORG → NotFound', async () => {
      await expect(service.getDashboard(PB, orgAId)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('NULL-ORG (leak input) → NotFound', async () => {
      await expect(service.getDashboard(PB, null as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── update (WRITE — assert the foreign row is NOT mutated) ─────────────────
  describe('update', () => {
    it('LEGIT same-org updates the project', async () => {
      const r = await service.update(PUA, orgAId, { name: 'legit-renamed' } as any);
      expect(r.name).toBe('legit-renamed');
    });
    it('CROSS-ORG → NotFound and the foreign row is UNCHANGED', async () => {
      await expect(
        service.update(PUB, orgAId, { name: 'HACKED' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const after = await projectRepo.findOne({ where: { id: PUB } });
      expect(after?.name).toBe(`xtenant-PUB-${PUB.slice(0, 8)}`); // no write leaked through
    });
    it('NULL-ORG (leak input) → NotFound and the foreign row is UNCHANGED', async () => {
      await expect(
        service.update(PUB, null as any, { name: 'HACKED' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      const after = await projectRepo.findOne({ where: { id: PUB } });
      expect(after?.name).toBe(`xtenant-PUB-${PUB.slice(0, 8)}`);
    });
  });

  // ─── deleteProject (DELETE — assert the foreign row STILL EXISTS) ───────────
  describe('deleteProject', () => {
    it('CROSS-ORG → NotFound and the foreign row STILL EXISTS', async () => {
      await expect(service.deleteProject(PDB, orgAId)).rejects.toBeInstanceOf(NotFoundException);
      const after = await projectRepo.findOne({ where: { id: PDB } });
      expect(after).not.toBeNull(); // no delete leaked through
    });
    it('NULL-ORG (leak input) → NotFound and the foreign row STILL EXISTS', async () => {
      await expect(service.deleteProject(PDB, null as any)).rejects.toBeInstanceOf(NotFoundException);
      const after = await projectRepo.findOne({ where: { id: PDB } });
      expect(after).not.toBeNull();
    });
    it('LEGIT same-org deletes the project', async () => {
      await service.deleteProject(PDA, orgAId);
      const after = await projectRepo.findOne({ where: { id: PDA } });
      expect(after).toBeNull();
    });
  });
});
