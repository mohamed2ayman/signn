import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { OperationsReviewController } from '../operations-review.controller';
import { OperationsReviewService } from '../operations-review.service';
import { KnowledgeAsset, OperationsSettings } from '../../../database/entities';
import { StorageService } from '../../storage/storage.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

/**
 * S3 follow-up — the ops-review queue now presigns each asset's `file_url` so
 * the "Open file" link works against a private S3 bucket.
 *
 * The load-bearing security property: a presigned URL is an auth-bypassing
 * link, so it must be minted ONLY inside getQueue, which runs AFTER
 * JwtAuthGuard + RolesGuard(@Roles SYSTEM_ADMIN, OPERATIONS). These tests use
 * the REAL RolesGuard + the REAL service + a mock storage to prove:
 *   (1) a non-OPS caller is rejected by the guard AND getDownloadUrl is NEVER
 *       called (mint-after-auth),
 *   (2) an authorised caller gets the presigned value, minted from the raw DB
 *       file_url; a null file_url stays null with no mint.
 */

// Typed loosely: the entity types file_url as `string`, but the column is
// nullable at runtime — the null-file_url row is exactly the case under test.
const ASSET_WITH_FILE: any = {
  id: 'asset-1',
  title: 'Doc One',
  asset_type: 'CONTRACT',
  file_url: 'http://localhost:3000/uploads/raw-one.pdf',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};
const ASSET_NO_FILE: any = {
  id: 'asset-2',
  title: 'Doc Two',
  asset_type: 'CONTRACT',
  file_url: null,
  created_at: new Date('2026-01-02T00:00:00.000Z'),
};

function makeQb() {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue([[ASSET_WITH_FILE, ASSET_NO_FILE], 2]),
  };
  return qb;
}

describe('OperationsReview — queue file_url presigning + mint-after-auth', () => {
  let app: INestApplication;
  let mockAssetRepo: { createQueryBuilder: jest.Mock };
  let mockStorage: { getDownloadUrl: jest.Mock };

  async function buildApp(role: string): Promise<INestApplication> {
    mockAssetRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    mockStorage = {
      getDownloadUrl: jest.fn(async (url: string) => `presigned:${url}`),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [OperationsReviewController],
      providers: [
        OperationsReviewService,
        { provide: getRepositoryToken(KnowledgeAsset), useValue: mockAssetRepo },
        { provide: getRepositoryToken(OperationsSettings), useValue: {} },
        { provide: StorageService, useValue: mockStorage },
      ],
    })
      // Real RolesGuard stays active; only the JWT layer is stubbed to inject a user.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'u1', role };
          return true;
        },
      })
      .compile();

    const built = moduleRef.createNestApplication();
    built.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await built.init();
    return built;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('rejects a non-OPS caller (403) AND never mints a presigned URL', async () => {
    app = await buildApp('REVIEWER');

    await request(app.getHttpServer())
      .get('/admin/operations-review/queue')
      .expect(403);

    // The guard denied before the handler: the service never ran, so no mint.
    expect(mockAssetRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(mockStorage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('authorises OPERATIONS, presigns from the raw DB file_url, keeps null as null', async () => {
    app = await buildApp('OPERATIONS');

    const res = await request(app.getHttpServer())
      .get('/admin/operations-review/queue')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].file_url).toBe(
      'presigned:http://localhost:3000/uploads/raw-one.pdf',
    );
    expect(res.body.data[1].file_url).toBeNull();

    // Minted exactly once — from the raw DB url, and never for the null row.
    expect(mockStorage.getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockStorage.getDownloadUrl).toHaveBeenCalledWith(
      'http://localhost:3000/uploads/raw-one.pdf',
    );
  });

  it('also authorises SYSTEM_ADMIN', async () => {
    app = await buildApp('SYSTEM_ADMIN');
    await request(app.getHttpServer())
      .get('/admin/operations-review/queue')
      .expect(200);
    expect(mockStorage.getDownloadUrl).toHaveBeenCalled();
  });
});
