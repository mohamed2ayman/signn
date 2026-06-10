import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionLevelGuard } from '../../../common/guards/permission-level.guard';
import { ComplianceObligationsController } from '../controllers/compliance-obligations.controller';
import { ComplianceObligationService } from '../services/compliance-obligation.service';
import { IcalExportService } from '../services/ical-export.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import {
  Obligation,
  ObligationStatus,
  ObligationType,
  User,
} from '../../../database/entities';

/**
 * PRE-S2c HOTFIX — cross-tenant stop-gap walls on the obligation child routes
 * of ComplianceObligationsController.
 *
 * Red-before/green-after: each "wall" test below FAILED against the pre-fix
 * controller (org-A caller acting on an org-B contract's obligation succeeded
 * with 200/201/204, or the project list ran with no org predicate). The walls
 * use ONLY the existing primitives:
 *
 *   - assertContractInCallerOrg → ContractAccessService.findInOrg
 *     (contract → project → organization_id; 404 — never 403 — on miss)
 *   - obligation.contract_id === :contractId pin (404 on mismatch)
 *
 * Option B S2c will absorb these by-id loads into the scoped-repository
 * chokepoint; these walls then STAY as defense-in-depth.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures (valid UUID v4 shapes)
// ─────────────────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_IN_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRACT_IN_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // foreign org
const OBLIGATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASSIGNEE_USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const PROJECT_ID = 'abababab-abab-4bab-8bab-abababababab';

const ORG_A_USER: Partial<User> = {
  id: USER_ID,
  email: 'pm@org-a.com',
  organization_id: ORG_A,
  // OWNER_ADMIN — a PermissionLevelGuard bypass role. The walls are keyed on
  // orgId, not role, so they must fire for bypass roles too.
  role: 'OWNER_ADMIN' as any,
};

const NO_ORG_USER: Partial<User> = {
  id: USER_ID,
  email: 'guest@nowhere.com',
  organization_id: null as any,
  role: 'OWNER_ADMIN' as any,
};

/** Obligation living on CONTRACT_IN_A (the caller's own contract). */
const OBLIGATION_IN_A: Partial<Obligation> = {
  id: OBLIGATION_ID,
  contract_id: CONTRACT_IN_A,
  description: 'Submit insurance certificate',
  status: ObligationStatus.PENDING,
  obligation_type: ObligationType.INSURANCE,
  due_date: new Date('2026-12-01'),
};

/** Obligation living on CONTRACT_IN_B (a foreign org's contract). */
const OBLIGATION_IN_B: Partial<Obligation> = {
  ...OBLIGATION_IN_A,
  contract_id: CONTRACT_IN_B,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockObligationSvc = {
  assignUser: jest.fn(),
  unassignUser: jest.fn(),
  updateEvidence: jest.fn(),
  getPortfolio: jest.fn(),
  getCalendar: jest.fn(),
  getReminderLogs: jest.fn(),
};

const mockQb: any = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockObligationRepo = {
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockIcal = {
  build: jest.fn().mockReturnValue('BEGIN:VCALENDAR\nEND:VCALENDAR'),
};

/**
 * Mimics the real findInOrg semantics: the ONLY in-org pair is
 * (CONTRACT_IN_A, ORG_A); anything else (cross-tenant, unknown contract)
 * throws 404 — never 403, no existence leak.
 */
const mockContractAccess = { findInOrg: jest.fn() };

function resetMocks(): void {
  jest.clearAllMocks();
  mockContractAccess.findInOrg.mockImplementation(
    async (contractId: string, orgId: string) => {
      if (contractId === CONTRACT_IN_A && orgId === ORG_A) return {};
      throw new NotFoundException('Contract not found');
    },
  );
  mockQb.leftJoinAndSelect.mockReturnThis();
  mockQb.leftJoin.mockReturnThis();
  mockQb.where.mockReturnThis();
  mockQb.andWhere.mockReturnThis();
  mockQb.orderBy.mockReturnThis();
  mockQb.getMany.mockResolvedValue([OBLIGATION_IN_A]);
  mockObligationRepo.createQueryBuilder.mockReturnValue(mockQb);
  mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_A });
  mockObligationRepo.save.mockImplementation(async (o: any) => o);
  mockObligationRepo.find.mockResolvedValue([]);
}

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(user: Partial<User>): Promise<INestApplication> {
  const mockJwtGuard = {
    canActivate: (ctx: ExecutionContext) => {
      const req = ctx.switchToHttp().getRequest();
      if (!req.headers.authorization?.includes('valid-token')) {
        throw new UnauthorizedException();
      }
      req.user = user;
      return true;
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ComplianceObligationsController],
    providers: [
      { provide: ComplianceObligationService, useValue: mockObligationSvc },
      { provide: IcalExportService, useValue: mockIcal },
      { provide: ContractAccessService, useValue: mockContractAccess },
      { provide: getRepositoryToken(Obligation), useValue: mockObligationRepo },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(mockJwtGuard)
    .overrideGuard(PermissionLevelGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Org-A caller — the cross-tenant probes
// ─────────────────────────────────────────────────────────────────────────────

describe('ComplianceObligationsController — PRE-S2c cross-tenant walls (org-A caller)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    resetMocks();
    app = await buildApp(ORG_A_USER);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(resetMocks);

  // ── Route A: PATCH /contracts/:contractId/obligations/:obligationId ──────

  describe('PATCH update — cross-tenant WRITE wall', () => {
    it('org-A caller patching an obligation on org-B contract → 404, nothing loaded, nothing saved', async () => {
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });

      const res = await request(app.getHttpServer())
        .patch(`/contracts/${CONTRACT_IN_B}/obligations/${OBLIGATION_ID}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(404);
      expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // Wall fires BEFORE any obligation load or write.
      expect(mockObligationRepo.findOne).not.toHaveBeenCalled();
      expect(mockObligationRepo.save).not.toHaveBeenCalled();
    });

    it('in-org contract but obligation belongs to a DIFFERENT contract → 404, nothing saved', async () => {
      // Caller pins their own contract in the URL, but the obligation id
      // actually lives on another contract (e.g. org-B's).
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });

      const res = await request(app.getHttpServer())
        .patch(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(404);
      expect(mockObligationRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org contract + obligation-in-contract → 200, walls consulted, save runs', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(mockObligationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: OBLIGATION_ID,
          status: ObligationStatus.COMPLETED,
        }),
      );
    });
  });

  // ── Route B1: POST assign ─────────────────────────────────────────────────

  describe('POST assign — cross-tenant wall', () => {
    it('org-A caller assigning on org-B contract → 404, service never reached', async () => {
      const res = await request(app.getHttpServer())
        .post(`/contracts/${CONTRACT_IN_B}/obligations/${OBLIGATION_ID}/assign`)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(404);
      expect(mockObligationSvc.assignUser).not.toHaveBeenCalled();
    });

    it('in-org contract but obligation on a different contract → 404, service never reached', async () => {
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });

      const res = await request(app.getHttpServer())
        .post(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/assign`)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(404);
      expect(mockObligationSvc.assignUser).not.toHaveBeenCalled();
    });

    it('happy path: walls pass → 201, service called', async () => {
      mockObligationSvc.assignUser.mockResolvedValue({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
      });

      const res = await request(app.getHttpServer())
        .post(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/assign`)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(201);
      expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(mockObligationSvc.assignUser).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ASSIGNEE_USER_ID,
        USER_ID,
      );
    });
  });

  // ── Route B2: DELETE unassign ────────────────────────────────────────────

  describe('DELETE unassign — cross-tenant wall', () => {
    it('org-A caller unassigning on org-B contract → 404, service never reached', async () => {
      const res = await request(app.getHttpServer())
        .delete(
          `/contracts/${CONTRACT_IN_B}/obligations/${OBLIGATION_ID}/assign/${ASSIGNEE_USER_ID}`,
        )
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
      expect(mockObligationSvc.unassignUser).not.toHaveBeenCalled();
    });

    it('in-org contract but obligation on a different contract → 404, service never reached', async () => {
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });

      const res = await request(app.getHttpServer())
        .delete(
          `/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/assign/${ASSIGNEE_USER_ID}`,
        )
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
      expect(mockObligationSvc.unassignUser).not.toHaveBeenCalled();
    });

    it('happy path: walls pass → 204, service called', async () => {
      mockObligationSvc.unassignUser.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .delete(
          `/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/assign/${ASSIGNEE_USER_ID}`,
        )
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(204);
      expect(mockObligationSvc.unassignUser).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ASSIGNEE_USER_ID,
      );
    });
  });

  // ── Route B3: PUT evidence ───────────────────────────────────────────────

  describe('PUT evidence — cross-tenant wall', () => {
    const EVIDENCE_URL = 'https://storage.sign.com/evidence.pdf';

    it('org-A caller attaching evidence on org-B contract → 404, service never reached', async () => {
      const res = await request(app.getHttpServer())
        .put(`/contracts/${CONTRACT_IN_B}/obligations/${OBLIGATION_ID}/evidence`)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(404);
      expect(mockObligationSvc.updateEvidence).not.toHaveBeenCalled();
    });

    it('in-org contract but obligation on a different contract → 404, service never reached', async () => {
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });

      const res = await request(app.getHttpServer())
        .put(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/evidence`)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(404);
      expect(mockObligationSvc.updateEvidence).not.toHaveBeenCalled();
    });

    it('happy path: walls pass → 200, service called', async () => {
      mockObligationSvc.updateEvidence.mockResolvedValue({
        ...OBLIGATION_IN_A,
        evidence_url: EVIDENCE_URL,
      });

      const res = await request(app.getHttpServer())
        .put(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/evidence`)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(200);
      expect(mockObligationSvc.updateEvidence).toHaveBeenCalledWith(
        OBLIGATION_ID,
        EVIDENCE_URL,
      );
    });
  });

  // ── Route C: GET ical ────────────────────────────────────────────────────

  describe('GET ical — cross-tenant wall', () => {
    it('org-A caller exporting org-B contract obligations → 404, nothing loaded', async () => {
      const res = await request(app.getHttpServer())
        .get(`/contracts/${CONTRACT_IN_B}/obligations/ical`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
      expect(mockObligationRepo.find).not.toHaveBeenCalled();
      expect(mockIcal.build).not.toHaveBeenCalled();
    });

    it('happy path: in-org contract → 200 text/calendar, wall consulted', async () => {
      mockObligationRepo.find.mockResolvedValue([
        { ...OBLIGATION_IN_A, contract: { name: 'Contract A' } },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/contracts/${CONTRACT_IN_A}/obligations/ical`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(res.text).toContain('BEGIN:VCALENDAR');
    });
  });

  // ── Route D: GET reminders ───────────────────────────────────────────────

  describe('GET reminders — org gate on top of the existing contract pin', () => {
    it('org-A caller reading reminder logs on org-B contract (pin matches) → 404, logs never read', async () => {
      // The pre-fix pin (obligation.contract_id === :contractId) PASSES here —
      // the obligation genuinely belongs to org-B's contract. Only the org
      // wall can stop this read.
      mockObligationRepo.findOne.mockResolvedValue({ ...OBLIGATION_IN_B });
      mockObligationSvc.getReminderLogs.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get(
          `/contracts/${CONTRACT_IN_B}/obligations/${OBLIGATION_ID}/reminders`,
        )
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
      expect(mockObligationSvc.getReminderLogs).not.toHaveBeenCalled();
    });

    it('happy path: in-org contract + pin matches → 200', async () => {
      mockObligationSvc.getReminderLogs.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get(
          `/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}/reminders`,
        )
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(mockContractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
    });
  });

  // ── Route F: GET /projects/:projectId/obligations ────────────────────────

  describe('GET project obligations — org predicate on the QB', () => {
    it('query carries the canonical contract→project org join + predicate', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${PROJECT_ID}/obligations`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(mockQb.leftJoin).toHaveBeenCalledWith('c.project', 'p');
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'p.organization_id = :orgId',
        { orgId: ORG_A },
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-org caller — the walls must fire WITHOUT calling findInOrg
// ─────────────────────────────────────────────────────────────────────────────

describe('ComplianceObligationsController — PRE-S2c walls (no-org caller)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    resetMocks();
    app = await buildApp(NO_ORG_USER);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(resetMocks);

  it('PATCH update: no-org caller → 404, findInOrg never called, nothing saved', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/contracts/${CONTRACT_IN_A}/obligations/${OBLIGATION_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(404);
    expect(mockContractAccess.findInOrg).not.toHaveBeenCalled();
    expect(mockObligationRepo.save).not.toHaveBeenCalled();
  });

  it('GET project obligations: no-org caller → 200 with [], query never built', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${PROJECT_ID}/obligations`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockObligationRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
