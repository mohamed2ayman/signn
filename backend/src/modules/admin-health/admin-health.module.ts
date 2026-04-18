import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AdminHealthController } from './admin-health.controller';
import { AdminHealthService } from './admin-health.service';

@Module({
  imports: [
    // Registering queues here allows AdminHealthService to inject them.
    // BullModule.forRootAsync (Redis connection) is already configured in AppModule.
    // Re-registering an existing queue name is idempotent and safe.
    BullModule.registerQueue(
      { name: 'email-queue' },
      { name: 'obligation-reminders' },
    ),
  ],
  controllers: [AdminHealthController],
  providers: [AdminHealthService],
})
export class AdminHealthModule {}
