import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as fsPromises from 'fs/promises';
import { OperationsReviewService } from '../operations-review.service';
import {
  KnowledgeAsset,
  OperationsSettings,
} from '../../../database/entities';

/**
 * Unit coverage for the DB-backed confidence-threshold methods — the S3/AWS
 * follow-up that moved the value off an on-disk JSON file
 * (path.resolve(__dirname, '../../config/operations-config.json')) into the
 * `operations_settings` singleton row.
 *
 * Repos are mocked here, so this runs everywhere (no DATABASE_URL needed). The
 * DB-dependent proofs (real round-trip, replica-safety, default-90 on a truly
 * absent row) live in operations-review-threshold.real-pg.spec.ts.
 */
describe('OperationsReviewService — confidence threshold (unit)', () => {
  let service: OperationsReviewService;
  let settingsRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    settingsRepo = { findOne: jest.fn(), save: jest.fn() };
    service = new OperationsReviewService(
      {} as unknown as Repository<KnowledgeAsset>,
      settingsRepo as unknown as Repository<OperationsSettings>,
      // storage — unused by the confidence-threshold methods under test
      {} as any,
    );
  });

  describe('getConfidenceThreshold', () => {
    it('returns the stored value when the singleton row exists', async () => {
      settingsRepo.findOne.mockResolvedValue({
        id: 'global',
        confidence_threshold: 75,
        updated_at: new Date(),
      });
      await expect(service.getConfidenceThreshold()).resolves.toEqual({
        threshold: 75,
      });
      expect(settingsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'global' },
      });
    });

    it('defaults to 90 when the row is absent (fresh DB, seed missing)', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      await expect(service.getConfidenceThreshold()).resolves.toEqual({
        threshold: 90,
      });
    });

    it('defaults to 90 (never throws) on a read error', async () => {
      settingsRepo.findOne.mockRejectedValue(new Error('relation missing'));
      await expect(service.getConfidenceThreshold()).resolves.toEqual({
        threshold: 90,
      });
    });
  });

  describe('setConfidenceThreshold', () => {
    it.each([-1, 101, NaN])(
      'rejects out-of-range value %p WITHOUT writing',
      async (bad) => {
        await expect(
          service.setConfidenceThreshold(bad),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(settingsRepo.save).not.toHaveBeenCalled();
      },
    );

    it('accepts the 0 and 100 bounds', async () => {
      settingsRepo.save.mockResolvedValue(undefined);
      settingsRepo.findOne.mockResolvedValue({
        id: 'global',
        confidence_threshold: 0,
        updated_at: new Date(),
      });
      await expect(service.setConfidenceThreshold(0)).resolves.toMatchObject({
        threshold: 0,
      });
      settingsRepo.findOne.mockResolvedValue({
        id: 'global',
        confidence_threshold: 100,
        updated_at: new Date(),
      });
      await expect(service.setConfidenceThreshold(100)).resolves.toMatchObject({
        threshold: 100,
      });
    });

    it('upserts the singleton row and returns an ISO updatedAt', async () => {
      const when = new Date('2026-01-02T03:04:05.000Z');
      settingsRepo.save.mockResolvedValue(undefined);
      settingsRepo.findOne.mockResolvedValue({
        id: 'global',
        confidence_threshold: 80,
        updated_at: when,
      });
      const res = await service.setConfidenceThreshold(80);
      expect(settingsRepo.save).toHaveBeenCalledWith({
        id: 'global',
        confidence_threshold: 80,
      });
      expect(res).toEqual({ threshold: 80, updatedAt: when.toISOString() });
    });
  });

  it('writes NOTHING to the filesystem (the on-disk JSON path is gone)', async () => {
    const writeSpy = jest.spyOn(fsPromises, 'writeFile');
    const mkdirSpy = jest.spyOn(fsPromises, 'mkdir');
    settingsRepo.save.mockResolvedValue(undefined);
    settingsRepo.findOne.mockResolvedValue({
      id: 'global',
      confidence_threshold: 42,
      updated_at: new Date(),
    });

    await service.setConfidenceThreshold(42);
    await service.getConfidenceThreshold();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
  });
});
