import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { Notification } from '../../database/entities';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { NotificationDispatchService } from './notification-dispatch.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Notification]),
    BullModule.registerQueue({
      name: 'email-queue',
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailService,
    EmailQueueProcessor,
    NotificationDispatchService,
  ],
  exports: [NotificationsService, EmailService, NotificationDispatchService],
})
export class NotificationsModule {}
