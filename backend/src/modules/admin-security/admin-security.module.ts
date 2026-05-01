import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  AuditLog,
  BlockedIpAttempt,
  Claim,
  Contract,
  KnownDevice,
  Notice,
  Notification,
  PasswordHistory,
  SecurityPolicy,
  SupportTicket,
  User,
  UserSession,
} from '../../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityPolicyService } from './services/security-policy.service';
import { SecurityEventService } from './services/security-event.service';
import { SessionService } from './services/session.service';
import { KnownDeviceService } from './services/known-device.service';
import { PasswordPolicyService } from './services/password-policy.service';
import { IpFilterService } from './services/ip-filter.service';
import { SuspiciousLoginService } from './services/suspicious-login.service';
import { GeoLookupService } from './services/geo-lookup.service';
import { UserAgentService } from './services/user-agent.service';
import { MfaAdminService } from './services/mfa-admin.service';
import { SecurityScoreService } from './services/security-score.service';
import { GdprExportService } from './services/gdpr-export.service';
import { AdminActivityLogService } from './services/admin-activity-log.service';
import { SecurityAuditLogService } from './services/security-audit-log.service';
import { ProfileController } from './controllers/profile.controller';
import {
  AdminSecurityController,
  AdminUserSecurityController,
} from './controllers/admin-security.controller';
import { IpFilterMiddleware } from './middleware/ip-filter.middleware';
import { SessionTrackingMiddleware } from './middleware/session-tracking.middleware';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      BlockedIpAttempt,
      Claim,
      Contract,
      KnownDevice,
      Notice,
      Notification,
      PasswordHistory,
      SecurityPolicy,
      SupportTicket,
      User,
      UserSession,
    ]),
    BullModule.registerQueue({ name: 'email-queue' }),
    NotificationsModule,
  ],
  controllers: [
    ProfileController,
    AdminSecurityController,
    AdminUserSecurityController,
  ],
  providers: [
    SecurityPolicyService,
    SecurityEventService,
    SessionService,
    KnownDeviceService,
    PasswordPolicyService,
    IpFilterService,
    SuspiciousLoginService,
    GeoLookupService,
    UserAgentService,
    MfaAdminService,
    SecurityScoreService,
    GdprExportService,
    AdminActivityLogService,
    SecurityAuditLogService,
  ],
  exports: [
    SecurityPolicyService,
    SecurityEventService,
    SessionService,
    KnownDeviceService,
    PasswordPolicyService,
    IpFilterService,
    SuspiciousLoginService,
    GeoLookupService,
    UserAgentService,
  ],
})
export class AdminSecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IpFilterMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
    consumer
      .apply(SessionTrackingMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
