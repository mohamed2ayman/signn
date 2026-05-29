/**
 * Phase 7.17 — Prompt 1, B.5 — RiskDriftController gating tests.
 *
 * The drift report is OWNER_ADMIN only. These tests mount the controller
 * in a real Nest app with the REAL RolesGuard (only JwtAuthGuard is
 * stubbed) and drive it over HTTP via supertest:
 *   - 200 for an OWNER_ADMIN caller (report returned, scoped to their org)
 *   - 403 for a non-OWNER_ADMIN caller (OWNER_REVIEWER)
 *   - 401 when no token is presented
 */

import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../../../database/entities';
import { RiskDriftController } from '../risk-drift.controller';
import { DriftReportService } from '../../services/drift-report.service';

const ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const MOCK_REPORT = {
  generated_at: new Date('2026-05-25T00:00:00.000Z'),
  org_summary: {
    total_overrides_30d: 5,
    total_overrides_lifetime: 12,
    most_overridden_categories: [],
  },
  drift_alerts: [],
  fallback_categories: [],
};

const mockDriftReport = {
  getDriftReport: jest.fn().mockResolvedValue(MOCK_REPORT),
  invalidate: jest.fn(),
};

// Stubbed JwtAuthGuard: token text selects the caller's role; the REAL
// RolesGuard then evaluates @Roles(OWNER_ADMIN) against req.user.role.
const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    if (!auth) throw new UnauthorizedException();
    if (auth.includes('owner-admin')) {
      req.user = { id: 'u1', organization_id: ORG_ID, role: UserRole.OWNER_ADMIN };
    } else if (auth.includes('reviewer')) {
      req.user = {
        id: 'u2',
        organization_id: ORG_ID,
        role: UserRole.OWNER_REVIEWER,
      };
    } else {
      throw new UnauthorizedException();
    }
    return true;
  },
};

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [RiskDriftController],
    providers: [{ provide: DriftReportService, useValue: mockDriftReport }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(mockJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('RiskDriftController — GET /settings/risk-drift (OWNER_ADMIN gate)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('200 for OWNER_ADMIN, scoped to caller org', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/risk-drift')
      .set('Authorization', 'Bearer owner-admin-token')
      .expect(200);

    expect(res.body.org_summary.total_overrides_lifetime).toBe(12);
    expect(res.body.drift_alerts).toEqual([]);
    expect(mockDriftReport.getDriftReport).toHaveBeenCalledWith(ORG_ID);
  });

  it('403 for a non-OWNER_ADMIN caller (OWNER_REVIEWER)', async () => {
    await request(app.getHttpServer())
      .get('/settings/risk-drift')
      .set('Authorization', 'Bearer reviewer-token')
      .expect(403);

    expect(mockDriftReport.getDriftReport).not.toHaveBeenCalled();
  });

  it('401 when no token is presented', async () => {
    await request(app.getHttpServer())
      .get('/settings/risk-drift')
      .expect(401);

    expect(mockDriftReport.getDriftReport).not.toHaveBeenCalled();
  });
});
