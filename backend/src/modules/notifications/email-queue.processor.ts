import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EmailService } from './email.service';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  /** Optional — for logging / debugging */
  templateName?: string;
  /** Optional — related entity for audit trail */
  relatedEntityType?: string;
  relatedEntityId?: string;
}

@Processor('email-queue')
export class EmailQueueProcessor {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private readonly emailService: EmailService) {}

  @Process('send-email')
  async handleSendEmail(job: Job<EmailJobData>): Promise<void> {
    const { to, subject, html, templateName } = job.data;

    this.logger.log(
      `Processing email job ${job.id} → ${to} [template: ${templateName || 'generic'}]`,
    );

    try {
      await this.emailService.sendGenericEmail(to, subject, html);
      this.logger.log(`Email job ${job.id} completed → ${to}`);
    } catch (error) {
      this.logger.error(
        `Email job ${job.id} failed → ${to}: ${error.message}`,
        error.stack,
      );
      throw error; // Bull will retry based on queue config
    }
  }
}
