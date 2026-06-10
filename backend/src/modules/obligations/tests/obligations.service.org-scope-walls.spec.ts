import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { ObligationsController } from '../obligations.controller';
import { ObligationsService } from '../obligations.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../../common/guards/permission-level.guard';

/**
 * PRE-S2c HOTFIX — org-scope walls on the org-wide obligation reads.
 *
 * Pre-fix, `GET /obligations/upcoming` and `GET /obligations/overdue` were
 * PLATFORM-WIDE: `getUpcoming` ran a bare repo.find and `getOverdue` a QB,
 * neither with any org predicate — every tenant's obligations (descriptions,
 * due dates, contract names via the joined relation) were returned to any
 * authenticated caller. Red-before/green-after: the predicate assertions
 * below failed against the pre-fix service.
 *
 * The fix org-scopes both queries via the canonical join
 * (obligation.contract → contract.project AND p.organization_id = :orgId),
 * threading the caller's orgId from the controller via @OrganizationId().
 * Same posture as getPortfolio/getCalendar in ComplianceObligationService.
 * Option B S2c later subsumes these into the scoped chokepoint; the walls
 * stay as defense-in-depth.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';

function buildQb(rows: any[] = []): any {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

const noopContractAccess = { findInOrg: jest.fn() } as any;

function buildService(repo: any): ObligationsService {
  return new ObligationsService(repo, noopContractAccess);
}

// ─────────────────────────────────────────────────────────────────────────────
// Service unit — the org predicate itself
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsService — PRE-S2c org-scope walls on upcoming/overdue', () => {
  beforeEach(jest.clearAllMocks);

  describe('getUpcoming()', () => {
    it('query is org-scoped via the canonical contract→project join', async () => {
      const qb = buildQb([{ id: 'obligation-in-a' }]);
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        find: jest.fn(),
      };
      const svc = buildService(repo);

      const result = await svc.getUpcoming(ORG_A, 30);

      expect(qb.leftJoin).toHaveBeenCalledWith('contract.project', 'p');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'p.organization_id = :orgId',
        { orgId: ORG_A },
      );
      // The unscoped FindOperator path must be gone entirely.
      expect(repo.find).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 'obligation-in-a' }]);
    });

    it('no-org caller → empty result, repo NEVER queried', async () => {
      const repo = { createQueryBuilder: jest.fn(), find: jest.fn() };
      const svc = buildService(repo);

      await expect(svc.getUpcoming(undefined as any, 30)).resolves.toEqual([]);

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('getOverdue()', () => {
    it('query is org-scoped via the canonical contract→project join', async () => {
      const qb = buildQb([]);
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        find: jest.fn(),
      };
      const svc = buildService(repo);

      await svc.getOverdue(ORG_A);

      expect(qb.leftJoin).toHaveBeenCalledWith('contract.project', 'p');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'p.organization_id = :orgId',
        { orgId: ORG_A },
      );
    });

    it('no-org caller → empty result, repo NEVER queried', async () => {
      const repo = { createQueryBuilder: jest.fn(), find: jest.fn() };
      const svc = buildService(repo);

      await expect(svc.getOverdue(undefined as any)).resolves.toEqual([]);

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Controller HTTP — the orgId threading
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsController — PRE-S2c orgId threading for upcoming/overdue', () => {
  const mockSvc = {
    getUpcoming: jest.fn().mockResolvedValue([]),
    getOverdue: jest.fn().mockResolvedValue([]),
  };

  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObligationsController],
      providers: [{ provide: ObligationsService, useValue: mockSvc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            id: 'user-uuid-1',
            role: 'OWNER_ADMIN',
            organization_id: ORG_A,
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionLevelGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(jest.clearAllMocks);

  it('GET /obligations/upcoming threads the caller orgId (default 30 days)', async () => {
    await request(app.getHttpServer())
      .get('/obligations/upcoming')
      .expect(200);

    expect(mockSvc.getUpcoming).toHaveBeenCalledWith(ORG_A, 30);
  });

  it('GET /obligations/upcoming?days=7 threads orgId AND the days param', async () => {
    await request(app.getHttpServer())
      .get('/obligations/upcoming')
      .query({ days: '7' })
      .expect(200);

    expect(mockSvc.getUpcoming).toHaveBeenCalledWith(ORG_A, 7);
  });

  it('GET /obligations/overdue threads the caller orgId', async () => {
    await request(app.getHttpServer())
      .get('/obligations/overdue')
      .expect(200);

    expect(mockSvc.getOverdue).toHaveBeenCalledWith(ORG_A);
  });
});
