import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OrganizationSubscription,
  PaymentTransaction,
  User,
} from '../../database/entities';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationSubscription,
      PaymentTransaction,
      User,
    ]),
  ],
  controllers: [AdminBillingController],
  providers: [AdminBillingService],
})
export class AdminBillingModule {}
