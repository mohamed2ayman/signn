import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../projects.service';
import { Project, Organization, User, UserRole } from '../../../database/entities';

/**
 * Cross-tenant leak fix — ProjectsService.findById (real Postgres).
 *
 * The bug: findById used `findOne({ where: { id, organization_id: orgId } })`
 * (find-options). TypeORM 0.3.x DROPS a null/undefined value from a find-options
 * `where`, so a null-org principal (a guest — org=null — reaching the no-@Roles
 * GET /projects/:id, or a null-org admin) got ANY project by id, cross-org, with
 * creator + members.user hydrated (email/role/mfa flags/last_login exposed). The
 * sibling findAll already failed closed via a QueryBuilder bound param.
 *
 * The fix: findById now uses a QueryBuilder that BINDS organization_id
 * (`.andWhere('project.organization_id = :orgId', { orgId })`) so a null orgId
 * compiles to `= NULL` → matches nothing → NotFound. Relations preserved via
 * leftJoinAndSelect (legit same-org reads unchanged).
 *
 * Seeds its own fixtures (org A / project PA, org B / project PB, each with its
 * own creator) — assertions key on the seeded ids, so ambient data doesn't matter.
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

describeReal('ProjectsService.findById — cross-tenant leak fix (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let projectRepo: Repository<Project>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let service: ProjectsService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID(); // creator in org A
  const userBId = randomUUID(); // creator in org B
  const PA = randomUUID(); // project in org A
  const PB = randomUUID(); // project in org B

  const seedUser = (id: string, orgId: string, label: string) =>
    userRepo.save(
      userRepo.create({
        id,
        email: `xtenant-${label}-${id.slice(0, 8)}@example.test`,
        password_hash: 'x', // FK target only, not a login path
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
    orgRepo = dataSource.getRepository(Organization);
    userRepo = dataSource.getRepository(User);

    // findById touches only projectRepository — the other 5 deps are stubbed.
    service = new ProjectsService(
      projectRepo,
      {} as any, // projectMemberRepository
      {} as any, // contractRepository
      {} as any, // projectPartyRepository
      {} as any, // riskAnalysisRepository
      {} as any, // partyRoles
    );

    await orgRepo.save(orgRepo.create({ id: orgAId, name: `xtenant-A-${orgAId.slice(0, 8)}` }));
    await orgRepo.save(orgRepo.create({ id: orgBId, name: `xtenant-B-${orgBId.slice(0, 8)}` }));
    await seedUser(userAId, orgAId, 'A');
    await seedUser(userBId, orgBId, 'B');
    await seedProject(PA, orgAId, userAId, 'PA');
    await seedProject(PB, orgBId, userBId, 'PB');
  });

  afterAll(async () => {
    await projectRepo.delete([PA, PB]);
    await userRepo.delete([userAId, userBId]);
    await orgRepo.delete([orgAId, orgBId]);
    await moduleRef?.close();
  });

  it('LEGIT same-org: findById(PA, orgA) returns PA with creator hydrated (relations preserved)', async () => {
    const p = await service.findById(PA, orgAId);
    expect(p.id).toBe(PA);
    expect(p.organization_id).toBe(orgAId);
    expect(p.creator?.id).toBe(userAId); // leftJoinAndSelect still hydrates creator
    expect(Array.isArray(p.members)).toBe(true);
  });

  it('CROSS-ORG: findById(PB, orgA) → NotFound (org A cannot read org B project)', async () => {
    await expect(service.findById(PB, orgAId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('NULL-ORG (the exact leak input): findById(PB, null) → NotFound (fails closed, not dropped)', async () => {
    // Pre-fix: find-options dropped the null org → PB returned cross-org. Post-fix:
    // the bound QueryBuilder compiles `organization_id = NULL` → matches nothing.
    await expect(service.findById(PB, null as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
