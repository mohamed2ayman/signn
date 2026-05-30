import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { PortfolioExportJob } from '../entities/portfolio-export-job.entity';
import { StorageService } from '../../storage/storage.service';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — expired-file sweep.
 *
 * Runs every 30 min via PortfolioExportCleanupScheduler. Finds rows
 * whose file is past its TTL but not yet swept, deletes the file via
 * StorageService (best-effort), and flips file_deleted=TRUE on the row.
 *
 * THE QUERY MUST INCLUDE `AND NOT file_deleted` (Bucket 3 carry-forward
 * from Bucket 1 review). The partial index
 *   idx_portfolio_export_jobs_expires_at
 *     ON portfolio_export_jobs (expires_at)
 *     WHERE file_deleted = FALSE
 * only matches a query whose WHERE predicate includes the same
 * `file_deleted = FALSE` clause. Without it, the planner falls back to
 * a seq scan — exactly the index-shape-mismatch trap #134/#135 warn
 * about. The query below explicitly carries the predicate so the index
 * is used.
 *
 * Bull job-name: 'cleanup-expired' on queue 'portfolio-export-jobs'.
 * Separate @Processor class from PortfolioExportProcessor — both register
 * on the same queue, distinguished by @Process('jobName').
 */
@Processor('portfolio-export-jobs')
export class PortfolioExportCleanupProcessor {
  private readonly logger = new Logger(PortfolioExportCleanupProcessor.name);

  private static readonly BATCH_SIZE = 100;

  constructor(
    @InjectRepository(PortfolioExportJob)
    private readonly jobRepo: Repository<PortfolioExportJob>,
    private readonly storage: StorageService,
  ) {}

  @Process({ name: 'cleanup-expired', concurrency: 1 })
  async handleCleanupExpired(_job: Job<Record<string, never>>): Promise<void> {
    // Single batch per cron tick — the next tick handles any backlog.
    // Predicate MUST carry `file_deleted = FALSE` to hit the partial index.
    const candidates = await this.jobRepo
      .createQueryBuilder('j')
      .where('j.expires_at < NOW()')
      .andWhere('j.file_deleted = FALSE')
      .orderBy('j.expires_at', 'ASC')
      .limit(PortfolioExportCleanupProcessor.BATCH_SIZE)
      .select(['j.id', 'j.file_path'])
      .getMany();

    if (candidates.length === 0) {
      this.logger.debug('Portfolio export cleanup tick: no expired files to sweep');
      return;
    }

    let succeeded = 0;
    let storageFailed = 0;

    for (const row of candidates) {
      try {
        if (row.file_path) {
          // StorageService.deleteFile is best-effort and never throws,
          // so this try/catch is belt-and-braces — it shouldn't fire,
          // but if any future adapter starts throwing we want to mark
          // the row swept anyway (the file's URL no longer matters once
          // we've recorded our intent to forget it).
          await this.storage.deleteFile(row.file_path);
        }
        await this.jobRepo.update(row.id, { file_deleted: true });
        succeeded++;
      } catch (err) {
        storageFailed++;
        this.logger.warn(
          `Portfolio export cleanup: failed to delete file for job ${row.id}: ${(err as Error).message}`,
        );
        // Still mark the row swept — exiting the partial index is the
        // important property. If the file's still there it will get
        // garbage-collected when the storage cleanup runs OR will simply
        // age out of the local volume / S3 lifecycle.
        await this.jobRepo.update(row.id, { file_deleted: true });
      }
    }

    this.logger.log(
      `Portfolio export cleanup tick: swept ${succeeded}/${candidates.length} ` +
        `(storage failures: ${storageFailed})`,
    );
  }
}
