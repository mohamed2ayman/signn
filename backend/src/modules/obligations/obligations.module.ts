import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Contract,
  Obligation,
  ObligationReminderLog,
  Project,
  User,
} from '../../database/entities';
import { ObligationsController } from './obligations.controller';
import { ObligationsService } from './obligations.service';
import { ObligationReminderProcessor } from './obligation-reminder.processor';
import { ObligationSchedulerService } from './obligation-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Obligation,
      ObligationReminderLog,
      Contract,
      Project,
      User,
    ]),
    BullModule.registerQueue({ name: 'obligation-reminders' }),
    NotificationsModule,
    forwardRef(() => ComplianceModule),
  ],
  controllers: [ObligationsController],
  providers: [
    ObligationsService,
    ObligationReminderProcessor,
    ObligationSchedulerService,
  ],
  exports: [ObligationsService],
})
export class ObligationsModule {}
