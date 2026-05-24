import {
  ConflictException,
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
import { ComplianceObligationsController } from '../controllers/compliance-obligations.controller';
import { ComplianceObligationService } from '../services/compliance-obligation.service';
import { IcalExportService } from '../services/ical-export.service';
import {
  Obligation,
  ObligationAssignee,
  ObligationStatus,
  ObligationType,
  User,
} from '../../../database/entities';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Must be valid UUID v4 (third group starts with 4, fourth group starts with 8/9/a/b)
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBLIGATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ASSIGNEE_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const MOCK_USER: Partial<User> = {
  id: USER_ID,
  email: 'pm@sign.com',
  first_name: 'Project',
  last_name: 'Manager',
  organization_id: ORG_ID,
};

const MOCK_OBLIGATION: Partial<Obligation> = {
  id: OBLIGATION_ID,
  contract_id: CONTRACT_ID,
  description: 'Submit insurance certificate',
  status: ObligationStatus.PENDING,
  obligation_type: ObligationType.INSURANCE,
  evidence_url: null as unknown as string,
  due_date: new Date('2026-12-01'),
  is_critical: false,
  reminder_schedule: [30, 14, 7, 1],
};

const MOCK_ASSIGNEE: Partial<ObligationAssignee> = {
  id: 'assignee-row-uuid',
  obligation_id: OBLIGATION_ID,
  user_id: ASSIGNEE_USER_ID,
  assigned_by: USER_ID,
};

const MOCK_CALENDAR_EVENT = {
  id: OBLIGATION_ID,
  title: 'Submit insurance certificate',
  start: '2026-12-01',
  end: '2026-12-01',
  status: ObligationStatus.PENDING,
  contract_id: CONTRACT_ID,
  project_id: 'project-uuid-001',
  color: '#4F6EF7',
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock guard — passes when Authorization header contains 'valid-token'
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors real JwtAuthGuard behaviour:
//   - throws UnauthorizedException (→ 401) when token absent/invalid
//   - populates req.user and returns true when token is valid
const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    if (!auth?.includes('valid-token')) {
      throw new UnauthorizedException();
    }
    req.user = MOCK_USER;
    return true;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Service mock
// ─────────────────────────────────────────────────────────────────────────────

const mockObligationSvc = {
  assignUser: jest.fn(),
  unassignUser: jest.fn(),
  updateEvidence: jest.fn(),
  getPortfolio: jest.fn(),
  getCalendar: jest.fn(),
};

// Obligation repo mock (used by the EXISTING endpoints in the controller)
const mockQb: any = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([MOCK_OBLIGATION]),
};

const mockObligationRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  findOne: jest.fn().mockResolvedValue(MOCK_OBLIGATION),
  save: jest.fn().mockResolvedValue(MOCK_OBLIGATION),
  find: jest.fn().mockResolvedValue([]),
};

const mockIcal = { build: jest.fn().mockReturnValue('BEGIN:VCALENDAR\nEND:VCALENDAR') };

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ComplianceObligationsController],
    providers: [
      { provide: ComplianceObligationService, useValue: mockObligationSvc },
      { provide: IcalExportService, useValue: mockIcal },
      {
        provide: getRepositoryToken(Obligation),
        useValue: mockObligationRepo,
      },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(mockJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ComplianceObligationService — Phase 7.1 unit', () => {
  let service: ComplianceObligationService;

  const mockAssigneeRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockObligationRepoUnit = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockContractRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceObligationService,
        {
          provide: getRepositoryToken(Obligation),
          useValue: mockObligationRepoUnit,
        },
        {
          provide: getRepositoryToken(require('../../../database/entities').Contract),
          useValue: mockContractRepo,
        },
        {
          provide: getRepositoryToken(ObligationAssignee),
          useValue: mockAssigneeRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(ComplianceObligationService);
  });

  // ── assignUser ─────────────────────────────────────────────────────────

  describe('assignUser()', () => {
    it('creates assignee row when user is not yet assigned', async () => {
      mockAssigneeRepo.findOne.mockResolvedValue(null);
      mockAssigneeRepo.create.mockReturnValue(MOCK_ASSIGNEE);
      mockAssigneeRepo.save.mockResolvedValue(MOCK_ASSIGNEE);

      const result = await service.assignUser(
        OBLIGATION_ID,
        ASSIGNEE_USER_ID,
        USER_ID,
      );
      expect(mockAssigneeRepo.create).toHaveBeenCalledWith({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
        assigned_by: USER_ID,
      });
      expect(result).toMatchObject({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
      });
    });

    it('throws ConflictException (409) when user is already assigned', async () => {
      mockAssigneeRepo.findOne.mockResolvedValue(MOCK_ASSIGNEE);

      await expect(
        service.assignUser(OBLIGATION_ID, ASSIGNEE_USER_ID, USER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── unassignUser ───────────────────────────────────────────────────────

  describe('unassignUser()', () => {
    it('deletes the assignee row successfully', async () => {
      mockAssigneeRepo.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.unassignUser(OBLIGATION_ID, ASSIGNEE_USER_ID),
      ).resolves.toBeUndefined();

      expect(mockAssigneeRepo.delete).toHaveBeenCalledWith({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
      });
    });

    it('throws NotFoundException (404) when assignee does not exist', async () => {
      mockAssigneeRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.unassignUser(OBLIGATION_ID, 'non-existent-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateEvidence ─────────────────────────────────────────────────────

  describe('updateEvidence()', () => {
    it('updates evidence_url and returns the saved obligation', async () => {
      const url = 'https://storage.sign.com/evidence.pdf';
      const updated = { ...MOCK_OBLIGATION, evidence_url: url };
      mockObligationRepoUnit.findOne.mockResolvedValue({ ...MOCK_OBLIGATION });
      mockObligationRepoUnit.save.mockResolvedValue(updated);

      const result = await service.updateEvidence(OBLIGATION_ID, url);
      expect(mockObligationRepoUnit.save).toHaveBeenCalledWith(
        expect.objectContaining({ evidence_url: url }),
      );
      expect(result.evidence_url).toBe(url);
    });

    it('throws NotFoundException when obligation does not exist', async () => {
      mockObligationRepoUnit.findOne.mockResolvedValue(null);

      await expect(
        service.updateEvidence('bad-uuid', 'https://example.com/ev.pdf'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getPortfolio ───────────────────────────────────────────────────────

  describe('getPortfolio()', () => {
    it('scopes query to the org and returns obligations', async () => {
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([MOCK_OBLIGATION]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      const result = await service.getPortfolio(ORG_ID, {});
      expect(mockQbLocal.where).toHaveBeenCalledWith(
        'p.organization_id = :orgId',
        { orgId: ORG_ID },
      );
      expect(result).toHaveLength(1);
    });

    it('applies project_id filter when provided', async () => {
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      await service.getPortfolio(ORG_ID, { project_id: 'project-uuid-001' });
      expect(mockQbLocal.andWhere).toHaveBeenCalledWith(
        'p.id = :projectId',
        { projectId: 'project-uuid-001' },
      );
    });

    it('applies assignee filter when provided', async () => {
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      await service.getPortfolio(ORG_ID, { assignee: ASSIGNEE_USER_ID });
      expect(mockQbLocal.andWhere).toHaveBeenCalledWith(
        'oa.user_id = :assignee',
        { assignee: ASSIGNEE_USER_ID },
      );
    });
  });

  // ── getCalendar ────────────────────────────────────────────────────────

  describe('getCalendar()', () => {
    it('returns calendar events with correct date fields', async () => {
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([MOCK_OBLIGATION]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      const events = await service.getCalendar(
        ORG_ID,
        '2026-11-01',
        '2026-12-31',
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: OBLIGATION_ID,
        start: '2026-12-01',
        end: '2026-12-01',
        status: ObligationStatus.PENDING,
        contract_id: CONTRACT_ID,
      });
    });

    it('uses BETWEEN :from AND :to clause for date filtering', async () => {
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      await service.getCalendar(ORG_ID, '2026-11-01', '2026-12-31');
      expect(mockQbLocal.andWhere).toHaveBeenCalledWith(
        'o.due_date BETWEEN :from AND :to',
        { from: '2026-11-01', to: '2026-12-31' },
      );
    });

    it('maps OVERDUE status to red color #DC2626', async () => {
      const overdueObligation = {
        ...MOCK_OBLIGATION,
        status: ObligationStatus.OVERDUE,
      };
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([overdueObligation]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      const events = await service.getCalendar(ORG_ID, '2026-01-01', '2026-12-31');
      expect(events[0].color).toBe('#DC2626');
    });

    it('maps MET/COMPLETED status to green color #059669', async () => {
      const metObligation = { ...MOCK_OBLIGATION, status: ObligationStatus.MET };
      const mockQbLocal: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([metObligation]),
      };
      mockObligationRepoUnit.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQbLocal);

      const events = await service.getCalendar(ORG_ID, '2026-01-01', '2026-12-31');
      expect(events[0].color).toBe('#059669');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER HTTP TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ComplianceObligationsController — Phase 7.1 HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset QueryBuilder mock chain for each test
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    mockQb.getMany.mockResolvedValue([MOCK_OBLIGATION]);
    mockObligationRepo.createQueryBuilder.mockReturnValue(mockQb);
  });

  // ── POST assign ────────────────────────────────────────────────────────

  describe('POST /contracts/:contractId/obligations/:obligationId/assign', () => {
    const path = `/contracts/${CONTRACT_ID}/obligations/${OBLIGATION_ID}/assign`;

    it('returns 201 and the assignee row on success', async () => {
      mockObligationSvc.assignUser.mockResolvedValue(MOCK_ASSIGNEE);

      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ obligation_id: OBLIGATION_ID });
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer())
        .post(path)
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(401);
    });

    it('returns 400 when user_id is not a valid UUID', async () => {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: 'not-a-uuid' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when user_id is missing', async () => {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 409 when user is already assigned', async () => {
      mockObligationSvc.assignUser.mockRejectedValue(
        new ConflictException('User is already assigned to this obligation'),
      );

      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ user_id: ASSIGNEE_USER_ID });

      expect(res.status).toBe(409);
    });
  });

  // ── DELETE unassign ────────────────────────────────────────────────────

  describe('DELETE /contracts/:contractId/obligations/:obligationId/assign/:userId', () => {
    const path = `/contracts/${CONTRACT_ID}/obligations/${OBLIGATION_ID}/assign/${ASSIGNEE_USER_ID}`;

    it('returns 204 on successful removal', async () => {
      mockObligationSvc.unassignUser.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .delete(path)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(204);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer()).delete(path);
      expect(res.status).toBe(401);
    });

    it('returns 404 when assignee does not exist', async () => {
      mockObligationSvc.unassignUser.mockRejectedValue(
        new NotFoundException('Assignee not found'),
      );

      const res = await request(app.getHttpServer())
        .delete(path)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });

  // ── PUT evidence ───────────────────────────────────────────────────────

  describe('PUT /contracts/:contractId/obligations/:obligationId/evidence', () => {
    const path = `/contracts/${CONTRACT_ID}/obligations/${OBLIGATION_ID}/evidence`;
    const EVIDENCE_URL = 'https://storage.sign.com/evidence.pdf';

    it('returns 200 and the updated obligation on success', async () => {
      const updated = { ...MOCK_OBLIGATION, evidence_url: EVIDENCE_URL };
      mockObligationSvc.updateEvidence.mockResolvedValue(updated);

      const res = await request(app.getHttpServer())
        .put(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ evidence_url: EVIDENCE_URL });
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer())
        .put(path)
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(401);
    });

    it('returns 400 when evidence_url is not a valid URL', async () => {
      const res = await request(app.getHttpServer())
        .put(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: 'not-a-url' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when obligation does not exist', async () => {
      mockObligationSvc.updateEvidence.mockRejectedValue(
        new NotFoundException('Obligation not found'),
      );

      const res = await request(app.getHttpServer())
        .put(path)
        .set('Authorization', 'Bearer valid-token')
        .send({ evidence_url: EVIDENCE_URL });

      expect(res.status).toBe(404);
    });
  });

  // ── GET portfolio ──────────────────────────────────────────────────────

  describe('GET /obligations/portfolio', () => {
    it('returns 200 and obligation array for authenticated user', async () => {
      mockObligationSvc.getPortfolio.mockResolvedValue([MOCK_OBLIGATION]);

      const res = await request(app.getHttpServer())
        .get('/obligations/portfolio')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(mockObligationSvc.getPortfolio).toHaveBeenCalledWith(
        ORG_ID,
        expect.any(Object),
      );
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer()).get('/obligations/portfolio');
      expect(res.status).toBe(401);
    });
  });

  // ── GET calendar ───────────────────────────────────────────────────────

  describe('GET /obligations/calendar', () => {
    it('returns 200 and calendar events for valid range', async () => {
      mockObligationSvc.getCalendar.mockResolvedValue([MOCK_CALENDAR_EVENT]);

      const res = await request(app.getHttpServer())
        .get('/obligations/calendar')
        .query({ from: '2026-11-01', to: '2026-12-31' })
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/obligations/calendar')
        .query({ from: '2026-11-01', to: '2026-12-31' });

      expect(res.status).toBe(401);
    });

    it('returns 400 when range exceeds 1 year', async () => {
      const res = await request(app.getHttpServer())
        .get('/obligations/calendar')
        .query({ from: '2025-01-01', to: '2026-12-31' }) // ~2 years
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('returns 400 when `to` is before `from`', async () => {
      const res = await request(app.getHttpServer())
        .get('/obligations/calendar')
        .query({ from: '2026-12-31', to: '2026-01-01' })
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('returns 400 when `from` is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/obligations/calendar')
        .query({ to: '2026-12-31' })
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
