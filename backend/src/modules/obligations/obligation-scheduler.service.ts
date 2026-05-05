import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class ObligationSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ObligationSchedulerService.name);

  constructor(
    @InjectQueue('obligation-reminders')
    private readonly reminderQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Clean existing repeatable jobs
    const existingJobs = await this.reminderQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      await this.reminderQueue.removeRepeatableByKey(job.key);
    }

    // Daily reminder pass at 06:00 UTC = 08:00 Cairo / 09:00 Riyadh / 10:00 Dubai.
    await this.reminderQueue.add(
      'check-reminders',
      {},
      {
        repeat: { cron: '0 6 * * *' },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Weekly digest — every Monday 06:00 UTC.
    await this.reminderQueue.add(
      'weekly-digest',
      {},
      {
        repeat: { cron: '0 6 * * 1' },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'Obligation scheduler initialised: daily reminders 06:00 UTC, weekly digest Monday 06:00 UTC',
    );
  }
}
