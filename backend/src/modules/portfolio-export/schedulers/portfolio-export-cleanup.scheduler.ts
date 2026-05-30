import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — registers the repeatable cleanup
 * cron on the portfolio-export-jobs queue.
 *
 * Mirrors ObligationSchedulerService's pattern (Phase 7.1): on module
 * init, clean any pre-existing repeatable jobs for this name (idempotent
 * across restarts) then add a fresh one.
 *
 * Cron: every 30 minutes. Cadence chosen so the worst-case latency
 * between expires_at and file deletion is ≤30 min — short enough that
 * the file's effective availability tracks the token TTL closely (1h
 * per PORTFOLIO_EXPORT_TTL_HOURS), long enough that the daily query
 * volume on the partial index stays trivial.
 */
@Injectable()
export class PortfolioExportCleanupScheduler implements OnModuleInit {
  private readonly logger = new Logger(PortfolioExportCleanupScheduler.name);

  constructor(
    @InjectQueue('portfolio-export-jobs')
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === 'cleanup-expired') {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      'cleanup-expired',
      {},
      {
        repeat: { cron: '*/30 * * * *' }, // every 30 minutes
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'Portfolio export cleanup scheduler initialised: every 30 min, expired-file sweep',
    );
  }
}
