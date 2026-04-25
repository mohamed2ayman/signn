import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import {
  SubscriptionPlan,
  OrganizationSubscription,
  Organization,
  PaymentTransaction,
} from '../../database/entities';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      OrganizationSubscription,
      Organization,
      PaymentTransaction,
    ]),
    ConfigModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
