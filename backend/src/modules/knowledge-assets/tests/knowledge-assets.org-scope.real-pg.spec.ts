import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import { KnowledgeAssetsService } from '../knowledge-assets.service';
import {
  KnowledgeAsset,
  AssetType,
  AssetReviewStatus,
  Organization,
} from '../../../database/entities';

/**
 * Cross-tenant org-scope leak fix (knowledge-assets) — real Postgres.
 *
 * The bug: `findAll`/`findById` applied org scope only inside `if (orgId)`, with
 * NO else. A falsy orgId (an org-less principal — SYSTEM_ADMIN / OPERATIONS /
 * guest) fell through to an UNSCOPED query and returned EVERY org's private
 * assets. The fix: a fail-closed `else` that scopes to GLOBAL/platform assets
 * only (`organization_id IS NULL`) — never another org's private assets.
 *
 * This spec SEEDS its own fixtures (org A private A1, org B private B1, one
 * global G) and proves:
 *   - as org A: sees A1 + G, NEVER B1 (the leak would return B1);
 *   - global (G) is still visible (legitimate global path preserved);
 *   - no-org (falsy orgId): GLOBAL ONLY — never A1 or B1 (the leak path).
 * Assertions key on the SEEDED ids, so ambient platform assets don't matter.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[knowledge-assets.org-scope] SKIPPING real-Postgres spec: DATABASE_URL ' +
      'unset. This MUST run against Postgres to prove the cross-tenant scope. ' +
      'CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('KnowledgeAssetsService — org-scope leak fix (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let assetRepo: Repository<KnowledgeAsset>;
  let orgRepo: Repository<Organization>;
  let service: KnowledgeAssetsService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const A1 = randomUUID(); // org A private
  const B1 = randomUUID(); // org B private
  const G = randomUUID(); // global (organization_id NULL)

  const seedAsset = (id: string, orgId: string | null, label: string) =>
    assetRepo.save(
      assetRepo.create({
        id,
        // undefined → column omitted → NULL (the nullable global tier).
        organization_id: orgId ?? undefined,
        project_id: undefined,
        title: `orgscope-${label}-${id.slice(0, 8)}`,
        asset_type: AssetType.KNOWLEDGE,
        review_status: AssetReviewStatus.APPROVED,
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
    assetRepo = dataSource.getRepository(KnowledgeAsset);
    orgRepo = dataSource.getRepository(Organization);

    // findAll/findById reads touch only the asset repo — stub the rest.
    service = new KnowledgeAssetsService(
      assetRepo,
      {} as any, // usageRepository
      {} as any, // versionRepository
      {} as any, // storageService
    );

    await orgRepo.save(orgRepo.create({ id: orgAId, name: `orgscope-A-${orgAId.slice(0, 8)}` }));
    await orgRepo.save(orgRepo.create({ id: orgBId, name: `orgscope-B-${orgBId.slice(0, 8)}` }));
    await seedAsset(A1, orgAId, 'A1');
    await seedAsset(B1, orgBId, 'B1');
    await seedAsset(G, null, 'G');
  });

  afterAll(async () => {
    await assetRepo.delete([A1, B1, G]);
    await orgRepo.delete([orgAId, orgBId]);
    await moduleRef?.close();
  });

  const ids = (rows: KnowledgeAsset[]) => rows.map((r) => r.id);

  describe('findAll', () => {
    it('as org A: returns A1 (own private) and G (global), NEVER B1 (org B private)', async () => {
      const got = ids(await service.findAll(orgAId));
      expect(got).toContain(A1); // own private
      expect(got).toContain(G); // global still visible (legitimate path)
      expect(got).not.toContain(B1); // ← the leak would include this
    });

    it('no org context (falsy orgId): GLOBAL ONLY — never A1 or B1 (the leak path, now fail-closed)', async () => {
      const got = ids(await service.findAll(undefined));
      expect(got).toContain(G); // global still returned
      expect(got).not.toContain(A1); // org A private not leaked
      expect(got).not.toContain(B1); // org B private not leaked
    });
  });

  describe('findById', () => {
    it('as org A: own private (A1) and global (G) resolve; org B private (B1) is NotFound', async () => {
      expect((await service.findById(A1, orgAId)).id).toBe(A1);
      expect((await service.findById(G, orgAId)).id).toBe(G);
      await expect(service.findById(B1, orgAId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('no org context: global (G) resolves; an org-private asset (A1) is NotFound (fail-closed)', async () => {
      expect((await service.findById(G, undefined)).id).toBe(G);
      await expect(service.findById(A1, undefined)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
