import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { Job } from 'bull';
import { Obligation, ObligationStatus } from '../../database/entities';
import { NotificationsService } from '../notifications/notifications.service';

@Processor('obligation-reminders')
export class ObligationReminderProcessor {
  private readonly logger = new Logger(ObligationReminderProcessor.name);

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process('check-reminders')
  async handleCheckReminders(job: Job): Promise<void> {
    this.logger.log('Checking for upcoming obligation reminders...');

    // Find obligations that need reminders
    const obligations = await this.obligationRepository
      .createQueryBuilder('obligation')
      .leftJoinAndSelect('obligation.contract', 'contract')
      .leftJoinAndSelect('contract.creator', 'creator')
      .where('obligation.status IN (:...statuses)', {
        statuses: [ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS],
      })
      .andWhere('obligation.due_date IS NOT NULL')
      .getMany();

    const now = new Date();
    let remindersSent = 0;

    for (const obligation of obligations) {
      const dueDate = new Date(obligation.due_date);
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Check if obligation is overdue
      if (daysUntilDue < 0 && obligation.status !== ObligationStatus.OVERDUE) {
        obligation.status = ObligationStatus.OVERDUE;
        await this.obligationRepository.save(obligation);
      }

      // Send reminder if within reminder window
      if (
        daysUntilDue >= 0 &&
        daysUntilDue <= obligation.reminder_days_before
      ) {
        // Notify the contract creator
        if (obligation.contract?.created_by) {
          await this.notificationsService.notifyObligationDue(
            obligation.contract.created_by,
            obligation.description,
            dueDate,
            obligation.id,
          );
          remindersSent++;
        }
      }
    }

    this.logger.log(
      `Obligation reminder check complete. ${remindersSent} reminders sent.`,
    );
  }
}
