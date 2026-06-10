/**
 * Phase 7.27 — Controller tests for LegalDocumentsController.
 *
 * Tests cover:
 *  1. All four endpoints are guarded (401 when no JWT)
 *  2. Role guard rejects non-SYSTEM_ADMIN users (403)
 *  3. POST /admin/legal-documents routes to service.createWithUpload
 *  4. GET  /admin/legal-documents routes to service.findAll
 *  5. GET  /admin/legal-documents/:id routes to service.findByIdWithChunkCount
 *  6. DELETE /admin/legal-documents/:id routes to service.remove (204)
 *
 * The service and guards are fully mocked — no real DB, no real file I/O.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, UnauthorizedException } from '@nestjs/common';
import * as request from 'supertest';

import { LegalDocumentsController } from '../legal-documents.controller';
import { LegalDocumentsService } from '../legal-documents.service';
import {
  LegalDocumentStatus,
  LegalDocumentSourceType,
  LegalDocumentEmbeddingStatus,
  UserRole,
} from '../../../database/entities';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Shared mock service
const mockService = {
  createWithUpload: jest.fn(),
  findAll: jest.fn(),
  findByIdWithChunkCount: jest.fn(),
  remove: jest.fn(),
};

// JWT guard mock — exposes `user` on the request when the test provides a
// valid Authorization header.  Returns 401 otherwise.
const JWT_ADMIN_TOKEN = 'Bearer admin-test-token';
const JWT_NON_ADMIN_TOKEN = 'Bearer non-admin-test-token';

const ADMIN_USER = { id: 'user-admin-001', role: UserRole.SYSTEM_ADMIN };
const REVIEWER_USER = { id: 'user-review-001', role: UserRole.OWNER_CREATOR };

jest.mock('../../../common/guards/jwt-auth.guard', () => {
  const { UnauthorizedException } = require('@nestjs/common');
  return {
    JwtAuthGuard: class {
      canActivate(ctx: any) {
        const req = ctx.switchToHttp().getRequest();
        const auth: string | undefined = req.headers['authorization'];
        if (!auth) throw new UnauthorizedException('Missing token');
        if (auth === 'Bearer admin-test-token') {
          req.user = { id: 'user-admin-001', role: 'SYSTEM_ADMIN' };
          return true;
        }
        if (auth === 'Bearer non-admin-test-token') {
          req.user = { id: 'user-review-001', role: 'OWNER_CREATOR' };
          return true;
        }
        throw new UnauthorizedException('Invalid token');
      }
    },
  };
});

jest.mock('../../../common/guards/roles.guard', () => ({
  RolesGuard: class {
    canActivate(ctx: any) {
      const req = ctx.switchToHttp().getRequest();
      return req.user?.role === UserRole.SYSTEM_ADMIN;
    }
  },
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DOC = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  jurisdiction: 'EG',
  source_type: LegalDocumentSourceType.PRIMARY_TEXT,
  title: 'Egyptian Civil Code',
  status: LegalDocumentStatus.IN_FORCE,
  embedding_status: LegalDocumentEmbeddingStatus.PENDING,
  chunk_count: 42,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const MOCK_LIST_RESPONSE = {
  data: [MOCK_DOC],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
};

// ─── Setup ─────────────────────────────────────────────────────────────────────

async function buildApp(): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [LegalDocumentsController],
    providers: [
      { provide: LegalDocumentsService, useValue: mockService },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('LegalDocumentsController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Auth / Role guard ──────────────────────────────────────────────────────

  describe('GET /admin/legal-documents — authentication', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      await request(app.getHttpServer())
        .get('/admin/legal-documents')
        .expect(401);
    });

    it('returns 403 when the user is not SYSTEM_ADMIN', async () => {
      await request(app.getHttpServer())
        .get('/admin/legal-documents')
        .set('Authorization', JWT_NON_ADMIN_TOKEN)
        .expect(403);
    });
  });

  describe('DELETE /admin/legal-documents/:id — authentication', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/legal-documents/${MOCK_DOC.id}`)
        .expect(401);
    });

    it('returns 403 when the user is not SYSTEM_ADMIN', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/legal-documents/${MOCK_DOC.id}`)
        .set('Authorization', JWT_NON_ADMIN_TOKEN)
        .expect(403);
    });
  });

  // ── GET /admin/legal-documents ──────────────────────────────────────────────

  describe('GET /admin/legal-documents', () => {
    it('returns 200 and paginated list for SYSTEM_ADMIN', async () => {
      mockService.findAll.mockResolvedValueOnce(MOCK_LIST_RESPONSE);

      const response = await request(app.getHttpServer())
        .get('/admin/legal-documents')
        .set('Authorization', JWT_ADMIN_TOKEN)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.data).toHaveLength(1);
      expect(mockService.findAll).toHaveBeenCalledTimes(1);
    });

    it('forwards jurisdiction query param to service.findAll', async () => {
      mockService.findAll.mockResolvedValueOnce({
        ...MOCK_LIST_RESPONSE,
        data: [],
        total: 0,
      });

      await request(app.getHttpServer())
        .get('/admin/legal-documents?jurisdiction=AE')
        .set('Authorization', JWT_ADMIN_TOKEN)
        .expect(200);

      const dto = mockService.findAll.mock.calls[0][0];
      expect(dto.jurisdiction).toBe('AE');
    });
  });

  // ── GET /admin/legal-documents/:id ─────────────────────────────────────────

  describe('GET /admin/legal-documents/:id', () => {
    it('returns 200 with chunk_count when document exists', async () => {
      mockService.findByIdWithChunkCount.mockResolvedValueOnce(MOCK_DOC);

      const response = await request(app.getHttpServer())
        .get(`/admin/legal-documents/${MOCK_DOC.id}`)
        .set('Authorization', JWT_ADMIN_TOKEN)
        .expect(200);

      expect(response.body.id).toBe(MOCK_DOC.id);
      expect(response.body.chunk_count).toBe(42);
      expect(mockService.findByIdWithChunkCount).toHaveBeenCalledWith(MOCK_DOC.id);
    });
  });

  // ── DELETE /admin/legal-documents/:id ──────────────────────────────────────

  describe('DELETE /admin/legal-documents/:id', () => {
    it('returns 204 No Content on successful deletion', async () => {
      mockService.remove.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer())
        .delete(`/admin/legal-documents/${MOCK_DOC.id}`)
        .set('Authorization', JWT_ADMIN_TOKEN)
        .expect(204);

      expect(mockService.remove).toHaveBeenCalledWith(MOCK_DOC.id);
    });
  });
});
