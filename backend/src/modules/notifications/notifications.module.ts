import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { Notification } from '../../database/entities';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { SesEmailProvider } from './providers/ses-email.provider';

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
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('EMAIL_DRIVER', 'smtp');

        if (driver === 'ses') {
          return new SesEmailProvider({
            region: config.get<string>('AWS_REGION', 'us-east-1'),
            accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', ''),
            secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
          });
        }

        // Default: SMTP (MailHog / Mailtrap in dev, any SMTP server otherwise)
        return new SmtpEmailProvider({
          host: config.get<string>('SMTP_HOST', 'localhost'),
          port: config.get<number>('SMTP_PORT', 1025),
          user: config.get<string>('SMTP_USER', ''),
          pass: config.get<string>('SMTP_PASS', ''),
        });
      },
    },
    NotificationsService,
    EmailService,
    EmailQueueProcessor,
    NotificationDispatchService,
  ],
  exports: [NotificationsService, EmailService, NotificationDispatchService],
})
export class NotificationsModule {}
