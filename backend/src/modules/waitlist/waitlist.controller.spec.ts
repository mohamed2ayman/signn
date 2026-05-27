import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { UserRole } from '../../database/entities';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ADMIN_USER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@sign.com',
  role: UserRole.SYSTEM_ADMIN,
};

const MOCK_ENTRY = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'test@example.com',
  product_name: 'VENDRIX',
  created_at: new Date('2026-05-27T10:00:00.000Z'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard mocks
// ─────────────────────────────────────────────────────────────────────────────

// JwtAuthGuard: throws 401 when no 'valid-token' in Authorization header;
// otherwise populates req.user (lesson #96: guards must THROW for 401, not return false)
const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    if (!auth?.includes('valid-token')) {
      throw new UnauthorizedException();
    }
    req.user = MOCK_ADMIN_USER;
    return true;
  },
};

// RolesGuard: throws 403 when req.user.role is not SYSTEM_ADMIN
const mockRolesGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role !== UserRole.SYSTEM_ADMIN) {
      throw new ForbiddenException();
    }
    return true;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Service mock
// ─────────────────────────────────────────────────────────────────────────────

const mockWaitlistService = {
  create: jest.fn(),
  findAll: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

// ThrottlerGuard pass-through: we are not testing rate limiting here,
// we are testing controller logic. Override to a no-op that always passes.
const mockThrottlerGuard = { canActivate: () => true };

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [WaitlistController],
    providers: [
      { provide: WaitlistService, useValue: mockWaitlistService },
    ],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue(mockThrottlerGuard)
    .overrideGuard(JwtAuthGuard)
    .useValue(mockJwtGuard)
    .overrideGuard(RolesGuard)
    .useValue(mockRolesGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WaitlistController (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitlistService.create.mockResolvedValue({ success: true });
    mockWaitlistService.findAll.mockResolvedValue([MOCK_ENTRY]);
  });

  // ─── POST /waitlist ───────────────────────────────────────────────────────

  describe('POST /waitlist', () => {
    it('200 — valid email and known product', async () => {
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ email: 'user@example.com', product_name: 'VENDRIX' })
        .expect(201) // NestJS @Post defaults to 201; service returns { success: true }
        .expect((res) => {
          expect(res.body).toEqual({ success: true });
        });
    });

    it('200 — duplicate email+product returns success silently (no 409)', async () => {
      // Service already returns { success: true } on duplicate (tested in service spec)
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ email: 'existing@example.com', product_name: 'CLAIMX' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({ success: true });
        });
    });

    it('400 — invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ email: 'not-an-email', product_name: 'VENDRIX' })
        .expect(400);
    });

    it('400 — unknown product_name', async () => {
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ email: 'user@example.com', product_name: 'SIGN' })
        .expect(400);
    });

    it('400 — missing email field', async () => {
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ product_name: 'VENDRIX' })
        .expect(400);
    });

    it('400 — missing product_name field', async () => {
      await request(app.getHttpServer())
        .post('/waitlist')
        .send({ email: 'user@example.com' })
        .expect(400);
    });
  });

  // ─── GET /admin/waitlist ──────────────────────────────────────────────────

  describe('GET /admin/waitlist', () => {
    it('401 — no Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/admin/waitlist')
        .expect(401);
    });

    it('403 — non-admin JWT (guard rejects non-SYSTEM_ADMIN role)', async () => {
      // Temporarily override to a non-admin user via a custom header trick:
      // The mock JWT guard requires 'valid-token' then sets req.user = MOCK_ADMIN_USER.
      // To test 403, we need the roles guard to fire. We do that by overriding
      // the JwtAuthGuard to populate a non-admin user for this specific test.
      const nonAdminApp = await (async () => {
        const moduleRef = await Test.createTestingModule({
          controllers: [WaitlistController],
          providers: [{ provide: WaitlistService, useValue: mockWaitlistService }],
        })
          .overrideGuard(ThrottlerGuard)
          .useValue(mockThrottlerGuard)
          .overrideGuard(JwtAuthGuard)
          .useValue({
            canActivate: (ctx: ExecutionContext) => {
              const req = ctx.switchToHttp().getRequest();
              req.user = { id: 'x', role: UserRole.OWNER_ADMIN };
              return true;
            },
          })
          .overrideGuard(RolesGuard)
          .useValue(mockRolesGuard)
          .compile();
        const a = moduleRef.createNestApplication();
        a.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await a.init();
        return a;
      })();

      await request(nonAdminApp.getHttpServer())
        .get('/admin/waitlist')
        .set('Authorization', 'Bearer valid-token')
        .expect(403);

      await nonAdminApp.close();
    });

    it('200 — SYSTEM_ADMIN receives waitlist entries', async () => {
      await request(app.getHttpServer())
        .get('/admin/waitlist')
        .set('Authorization', 'Bearer valid-token')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body[0].email).toBe('test@example.com');
        });
    });

    it('200 — optional product_name filter is forwarded to service', async () => {
      await request(app.getHttpServer())
        .get('/admin/waitlist?product_name=SPANTEC')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(mockWaitlistService.findAll).toHaveBeenCalledWith('SPANTEC');
    });
  });

  // ─── GET /admin/waitlist/export ───────────────────────────────────────────

  describe('GET /admin/waitlist/export', () => {
    it('200 — SYSTEM_ADMIN receives export data', async () => {
      await request(app.getHttpServer())
        .get('/admin/waitlist/export')
        .set('Authorization', 'Bearer valid-token')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('401 — no JWT', async () => {
      await request(app.getHttpServer())
        .get('/admin/waitlist/export')
        .expect(401);
    });
  });
});
