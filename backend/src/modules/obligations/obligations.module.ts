import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Obligation } from '../../database/entities';
import { ObligationsController } from './obligations.controller';
import { ObligationsService } from './obligations.service';
import { ObligationReminderProcessor } from './obligation-reminder.processor';
import { ObligationSchedulerService } from './obligation-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Obligation]),
    BullModule.registerQueue({
      name: 'obligation-reminders',
    }),
    NotificationsModule,
  ],
  controllers: [ObligationsController],
  providers: [ObligationsService, ObligationReminderProcessor, ObligationSchedulerService],
  exports: [ObligationsService],
})
export class ObligationsModule {}
