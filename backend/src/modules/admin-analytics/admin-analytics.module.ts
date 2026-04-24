import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Contract,
  KnowledgeAsset,
  OrganizationSubscription,
  SubscriptionPlan,
  User,
} from '../../database/entities';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Contract,
      KnowledgeAsset,
      OrganizationSubscription,
      SubscriptionPlan,
    ]),
    // Re-registering an existing queue name is idempotent and safe;
    // lets AdminAnalyticsService inject queue depth counters.
    BullModule.registerQueue(
      { name: 'email-queue' },
      { name: 'obligation-reminders' },
    ),
  ],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
