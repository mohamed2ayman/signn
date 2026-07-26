import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export const REDLINE_NOTIFICATION_QUEUE = 'redline-notifications';
export const REDLINE_DIGEST_JOB = 'flush-redline-digests';

/**
 * 7.19 Slice 4 — redline digest sweeper scheduler.
 *
 * Mirrors MeteringCleanupScheduler / PortfolioExportCleanupScheduler exactly:
 * on module init remove any pre-existing repeatable for THIS job name
 * (idempotent across restarts), then add a fresh one.
 *
 * ⚠️ This registers on its OWN queue (`redline-notifications`), deliberately
 * NOT on an existing one. `ObligationSchedulerService` removes ALL repeatable
 * jobs on `obligation-reminders` unconditionally at boot, so any repeatable
 * sharing a queue with a scheduler that does a blanket wipe is one boot-order
 * change away from silently disappearing. A dedicated queue is the cheap way
 * to stay clear of that class of bug.
 *
 * Cadence: every 60s against a 3-minute debounce window, so a suppressed event
 * waits at most window + 60s (~4 min) for its digest. The drain is a single
 * indexed DELETE … RETURNING over a table that only ever holds OPEN windows,
 * so a 60s tick is trivially cheap.
 *
 * NOTE: Bull repeatables are the ONLY scheduling mechanism in this codebase —
 * `@nestjs/schedule` is not installed and `@Cron` appears nowhere. Do not
 * introduce it for a single sweeper.
 */
@Injectable()
export class RedlineDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(RedlineDigestScheduler.name);

  constructor(
    @InjectQueue(REDLINE_NOTIFICATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === REDLINE_DIGEST_JOB) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      REDLINE_DIGEST_JOB,
      {},
      {
        repeat: { every: 60_000 }, // every 60s
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'Redline digest scheduler initialised: every 60s, elapsed-window flush',
    );
  }
}
