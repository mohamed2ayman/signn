import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PortfolioAnalyticsController } from '../portfolio-analytics.controller';
import { PortfolioAnalyticsService } from '../portfolio-analytics.service';
import { UserRole } from '../../../database/entities';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// JWT guard mock: token 'owner-admin' / 'creator' sets the matching role;
// anything else → 401. Mirrors real JwtAuthGuard populating req.user.
const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    if (auth?.includes('owner-admin')) {
      req.user = { id: 'u1', organization_id: ORG_ID, role: UserRole.OWNER_ADMIN };
      return true;
    }
    if (auth?.includes('creator')) {
      req.user = { id: 'u2', organization_id: ORG_ID, role: UserRole.OWNER_CREATOR };
      return true;
    }
    throw new UnauthorizedException();
  },
};

// Roles guard mock mirrors @Roles(OWNER_ADMIN): only OWNER_ADMIN passes,
// anything else → false → 403 Forbidden.
const mockRolesGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.role === UserRole.OWNER_ADMIN;
  },
};

const mockService = {
  getPortfolioAnalytics: jest.fn(),
};

describe('PortfolioAnalyticsController (role gating)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PortfolioAnalyticsController],
      providers: [{ provide: PortfolioAnalyticsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockService.getPortfolioAnalytics.mockResolvedValue({ period: '90d' });
  });

  it('401 when no/invalid token', async () => {
    await request(app.getHttpServer()).get('/portfolio-analytics').expect(401);
    expect(mockService.getPortfolioAnalytics).not.toHaveBeenCalled();
  });

  it('403 for a non-OWNER_ADMIN role (OWNER_CREATOR)', async () => {
    await request(app.getHttpServer())
      .get('/portfolio-analytics')
      .set('Authorization', 'Bearer creator-token')
      .expect(403);
    expect(mockService.getPortfolioAnalytics).not.toHaveBeenCalled();
  });

  it('200 for OWNER_ADMIN and defaults period to 90d, passing the org from the JWT', async () => {
    await request(app.getHttpServer())
      .get('/portfolio-analytics')
      .set('Authorization', 'Bearer owner-admin-token')
      .expect(200);
    expect(mockService.getPortfolioAnalytics).toHaveBeenCalledWith(
      ORG_ID,
      '90d',
      undefined,
    );
  });

  it('200 for OWNER_ADMIN forwards an explicit period + project_id', async () => {
    const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await request(app.getHttpServer())
      .get(`/portfolio-analytics?period=30d&project_id=${projectId}`)
      .set('Authorization', 'Bearer owner-admin-token')
      .expect(200);
    expect(mockService.getPortfolioAnalytics).toHaveBeenCalledWith(
      ORG_ID,
      '30d',
      projectId,
    );
  });
});
