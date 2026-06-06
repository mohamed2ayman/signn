import { forwardRef, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Contract,
  Obligation,
  ObligationAssignee,
  ObligationReminderLog,
  PermissionDefault,
  Project,
  ProjectMember,
  User,
} from '../../database/entities';
import { ObligationsController } from './obligations.controller';
import { ObligationsService } from './obligations.service';
import { ObligationReminderProcessor } from './obligation-reminder.processor';
import { ObligationSchedulerService } from './obligation-scheduler.service';
import { ObligationSchemaCheckService } from './obligation-schema-check.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ResolveObligationProjectMiddleware } from '../../common/middleware/resolve-obligation-project.middleware';
// Tenant-isolation Tier 2 — ObligationsService now injects
// ContractAccessService for the dashboard's optional contract_id filter.
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Obligation,
      ObligationAssignee,
      ObligationReminderLog,
      Contract,
      Project,
      User,
      ProjectMember,
      PermissionDefault,
    ]),
    BullModule.registerQueue({ name: 'obligation-reminders' }),
    NotificationsModule,
    forwardRef(() => ComplianceModule),
    ContractsModule,
  ],
  controllers: [ObligationsController],
  providers: [
    ObligationsService,
    ObligationReminderProcessor,
    ObligationSchedulerService,
    ObligationSchemaCheckService,
    PermissionLevelGuard,
    ResolveObligationProjectMiddleware,
  ],
  exports: [ObligationsService],
})
export class ObligationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ResolveObligationProjectMiddleware)
      .forRoutes('obligations');
  }
}
