import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

/**
 * Phase 7.18 — Metering Primitive: dangling-reserve sweeper scheduler.
 *
 * Mirrors PortfolioExportCleanupScheduler's pattern (Phase 7.17 2c) and
 * ObligationSchedulerService (Phase 7.1): on module init, clean any
 * pre-existing repeatable jobs for this name (idempotent across restarts)
 * then add a fresh one.
 *
 * Cadence: every 5 minutes. Reservation TTL is 1h by default; running
 * the sweeper every 5 min means the worst-case "dangling capacity" window
 * is at most TTL + 5min (~65 min). Short enough to keep over-denial small,
 * long enough that the partial-index sweep stays trivially cheap.
 */
@Injectable()
export class MeteringCleanupScheduler implements OnModuleInit {
  private readonly logger = new Logger(MeteringCleanupScheduler.name);

  constructor(
    @InjectQueue('metering-jobs')
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === 'cleanup-dangling-reserves') {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      'cleanup-dangling-reserves',
      {},
      {
        repeat: { cron: '*/5 * * * *' }, // every 5 minutes
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'Metering cleanup scheduler initialised: every 5 min, dangling-reserve sweep',
    );
  }
}
