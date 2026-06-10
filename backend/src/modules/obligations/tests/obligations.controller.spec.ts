import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ForbiddenException } from '@nestjs/common';
import * as request from 'supertest';
import { ObligationsController } from '../obligations.controller';
import { ObligationsService } from '../obligations.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../../common/guards/permission-level.guard';

// ─── Guard mocks ──────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'user-uuid-1',
  email: 'owner@sign.com',
  role: 'OWNER_ADMIN' as any,
  org_id: 'org-uuid-1',
  // PRE-S2c walls thread @OrganizationId() (req.user.organization_id) into
  // the /:id routes — the permission gate and the org gate are independent.
  organization_id: 'org-uuid-1',
};

/** Always passes — simulates OWNER_ADMIN (bypasses permission checks). */
const mockAuthGuard = { canActivate: () => true };

/** Always passes — roles guard pass-through for these tests. */
const mockRolesGuard = { canActivate: () => true };

/** Always passes — simulates an OWNER_ADMIN or project member with sufficient level. */
const mockPermissionGuard = { canActivate: () => true };

/** Always throws 403 — simulates a VIEWER trying a protected endpoint. */
const mockLowPermGuard = {
  canActivate: () => {
    throw new ForbiddenException('Insufficient permission level');
  },
};

// ─── Service mock ─────────────────────────────────────────────────────────────

const mockObligationsService = {
  findByContract: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue({ id: 'ob-uuid-1' }),
  create: jest.fn().mockResolvedValue({ id: 'ob-uuid-new' }),
  update: jest.fn().mockResolvedValue({ id: 'ob-uuid-1' }),
  complete: jest.fn().mockResolvedValue({ id: 'ob-uuid-1', status: 'COMPLETED' }),
  delete: jest.fn().mockResolvedValue(undefined),
  getUpcoming: jest.fn().mockResolvedValue([]),
  getOverdue: jest.fn().mockResolvedValue([]),
  getDashboard: jest.fn().mockResolvedValue({}),
};

// ─── App factory ─────────────────────────────────────────────────────────────

async function buildApp(permGuard = mockPermissionGuard): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [ObligationsController],
    providers: [
      { provide: ObligationsService, useValue: mockObligationsService },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: any) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = MOCK_USER;
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue(mockRolesGuard)
    .overrideGuard(PermissionLevelGuard)
    .useValue(permGuard)
    .compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsController', () => {
  let app: INestApplication;

  beforeEach(jest.clearAllMocks);

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── Unauthenticated ────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('GET /obligations/upcoming returns 200 with mocked auth', async () => {
      app = await buildApp();
      await request(app.getHttpServer())
        .get('/obligations/upcoming')
        .expect(200);
    });

    it('GET /obligations/overdue returns 200 with mocked auth', async () => {
      app = await buildApp();
      await request(app.getHttpServer())
        .get('/obligations/overdue')
        .expect(200);
    });
  });

  // ── Permission gates (Phase 7.15) ─────────────────────────────────────────

  describe('Phase 7.15 — permission gating', () => {
    it('DELETE /obligations/:id returns 403 when PermissionLevelGuard denies', async () => {
      app = await buildApp(mockLowPermGuard);
      const uuid = '00000000-0000-0000-0000-000000000001';
      await request(app.getHttpServer())
        .delete(`/obligations/${uuid}`)
        .expect(403);
    });

    it('POST /obligations returns 403 when PermissionLevelGuard denies', async () => {
      app = await buildApp(mockLowPermGuard);
      await request(app.getHttpServer())
        .post('/obligations')
        .send({
          description: 'Test',
          obligation_type: 'PAYMENT',
          status: 'PENDING',
        })
        .expect(403);
    });

    it('PUT /obligations/:id returns 403 when PermissionLevelGuard denies', async () => {
      app = await buildApp(mockLowPermGuard);
      const uuid = '00000000-0000-0000-0000-000000000001';
      await request(app.getHttpServer())
        .put(`/obligations/${uuid}`)
        .send({ description: 'Updated' })
        .expect(403);
    });

    it('DELETE /obligations/:id returns 200 when OWNER_ADMIN (guard passes)', async () => {
      app = await buildApp(mockPermissionGuard);
      const uuid = '00000000-0000-0000-0000-000000000001';
      await request(app.getHttpServer())
        .delete(`/obligations/${uuid}`)
        .expect(200)
        .expect({ message: 'Obligation deleted successfully' });
      // PRE-S2c: delete() now also receives the caller's orgId (org wall).
      expect(mockObligationsService.delete).toHaveBeenCalledWith(
        uuid,
        'org-uuid-1',
      );
    });

    it('GET /obligations/:id returns 403 when PermissionLevelGuard denies', async () => {
      app = await buildApp(mockLowPermGuard);
      const uuid = '00000000-0000-0000-0000-000000000001';
      await request(app.getHttpServer())
        .get(`/obligations/${uuid}`)
        .expect(403);
    });
  });
});
