import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import {
  ClauseRedline,
  ContractClause,
  RedlineNotificationBatch,
  User,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedlineService } from './redline.service';
import { RedlineController } from './redline.controller';
import { RedlineNotificationService } from './services/redline-notification.service';
import {
  RedlineDigestScheduler,
  REDLINE_NOTIFICATION_QUEUE,
} from './schedulers/redline-digest.scheduler';
import { RedlineDigestProcessor } from './processors/redline-digest.processor';

/**
 * 7.19 Slice 1 — counterparty redlining spine.
 *
 * Imports ContractsModule for ContractAccessService (the access wall:
 * org-first → binding-fallback / findInOrg) and ContractsService
 * (createVersionSnapshot — the ONE create-version entry point; the accept
 * path rides its EntityManager overload inside the redline txn). The
 * pin-guard util is pure (no DI). One-directional — ContractsModule does not
 * import this module (no cycle; the app-boot smoke test guards the wiring).
 *
 * 7.19 Slice 4 — notifications. Adds NotificationsModule (for the exported
 * NotificationDispatchService: in-app row + Bull email enqueue) and a
 * DEDICATED `redline-notifications` Bull queue carrying the digest sweeper.
 * The queue is deliberately its own, not shared: ObligationSchedulerService
 * blanket-removes every repeatable on its queue at boot, so co-tenanting a
 * repeatable there would be one boot-order change away from vanishing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClauseRedline,
      ContractClause,
      RedlineNotificationBatch,
      User,
    ]),
    BullModule.registerQueue({ name: REDLINE_NOTIFICATION_QUEUE }),
    ContractsModule,
    NotificationsModule,
  ],
  controllers: [RedlineController],
  providers: [
    RedlineService,
    RedlineNotificationService,
    RedlineDigestScheduler,
    RedlineDigestProcessor,
  ],
  exports: [RedlineService, RedlineNotificationService],
})
export class RedlineModule {}
