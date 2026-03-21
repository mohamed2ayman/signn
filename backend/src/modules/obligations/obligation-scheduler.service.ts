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

    // Schedule a daily check at 8:00 AM
    await this.reminderQueue.add(
      'check-reminders',
      {},
      {
        repeat: {
          cron: '0 8 * * *', // Every day at 8 AM
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('Obligation reminder scheduler initialized (daily at 8:00 AM)');
  }
}
