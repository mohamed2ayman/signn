import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  KnowledgeAsset,
  OperationsSettings,
} from '../../../database/entities';
import { OperationsReviewService } from '../operations-review.service';

// The real-Postgres connection bootstrap (TypeOrmModule.forRoot + all entities)
// exceeds Jest's default 5s hook budget; sibling *.real-pg specs do the same.
jest.setTimeout(60000);

/**
 * S3/AWS-readiness follow-up — the ops-review confidence threshold now lives in
 * the `operations_settings` singleton row instead of an on-disk JSON file
 * (which on ECS is lost on redeploy + diverges across replicas).
 *
 * Proven against REAL Postgres (must run in-container with DATABASE_URL — the
 * migration 1781000000001 must be applied first):
 *  (i)   round-trip: set() persists, a COLD service instance reads it back.
 *  (ii)  default 90 when the singleton row is truly absent (fresh DB).
 *  (iii) REPLICA SAFETY (the whole point): two independent service instances
 *        backed by the same DB always agree on the stored value — no per-task
 *        disk divergence.
 *  (iv)  the 0-100 validation still rejects out-of-range against the real DB.
 *
 * RED before migration 1781000000001 is applied: every DB-touching test fails
 * on `relation "operations_settings" does not exist`. GREEN below proves the
 * migration + wiring, not just the code path.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[operations-review-threshold] SKIPPING real-Postgres spec: DATABASE_URL ' +
      'unset — this MUST run against Postgres to prove the DB round-trip, the ' +
      'default-90 fallback on an absent row, and replica-safety (two service ' +
      'instances share one DB). CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const SINGLETON_ID = 'global';

describeReal('operations_settings confidence threshold (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: OperationsReviewService;

  const makeService = () =>
    new OperationsReviewService(
      dataSource.getRepository(KnowledgeAsset),
      dataSource.getRepository(OperationsSettings),
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
    service = makeService();
  });

  afterAll(async () => {
    // Leave the singleton at the seeded default so the row exists for the app.
    if (dataSource?.isInitialized) {
      await dataSource
        .getRepository(OperationsSettings)
        .save({ id: SINGLETON_ID, confidence_threshold: 90 });
    }
    await moduleRef?.close();
  });

  it('round-trips: set() persists to the DB and a cold instance reads it back', async () => {
    await service.setConfidenceThreshold(63);

    // A fresh service instance (no in-memory state) sees the DB value.
    const reader = makeService();
    await expect(reader.getConfidenceThreshold()).resolves.toEqual({
      threshold: 63,
    });

    // And the value is really in the table.
    const row = await dataSource
      .getRepository(OperationsSettings)
      .findOne({ where: { id: SINGLETON_ID } });
    expect(row?.confidence_threshold).toBe(63);
  });

  it('defaults to 90 when the singleton row is absent, and set() re-creates it', async () => {
    await dataSource
      .getRepository(OperationsSettings)
      .delete({ id: SINGLETON_ID });

    await expect(service.getConfidenceThreshold()).resolves.toEqual({
      threshold: 90,
    });

    // set() defensively re-creates the row even though the seed was gone.
    await service.setConfidenceThreshold(88);
    const row = await dataSource
      .getRepository(OperationsSettings)
      .findOne({ where: { id: SINGLETON_ID } });
    expect(row?.confidence_threshold).toBe(88);
  });

  it('REPLICA SAFETY: two independent service instances share the one stored value', async () => {
    // Two service instances = two ECS replicas backed by the same DB.
    const replicaA = makeService();
    const replicaB = makeService();

    await replicaA.setConfidenceThreshold(41);
    // B, which never wrote, immediately observes A's value (no per-instance disk).
    await expect(replicaB.getConfidenceThreshold()).resolves.toEqual({
      threshold: 41,
    });

    await replicaB.setConfidenceThreshold(59);
    await expect(replicaA.getConfidenceThreshold()).resolves.toEqual({
      threshold: 59,
    });
  });

  it('still rejects out-of-range values (0-100) against the real DB', async () => {
    await expect(service.setConfidenceThreshold(-5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.setConfidenceThreshold(150)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
