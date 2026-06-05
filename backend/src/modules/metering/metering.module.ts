import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { Contract } from '../../database/entities';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

import { MeterDefinition } from './entities/meter-definition.entity';
import { PlanAllowance } from './entities/plan-allowance.entity';
import { SubjectAllowance } from './entities/subject-allowance.entity';
import { MeteringLedger } from './entities/metering-ledger.entity';
import { MeteringBalance } from './entities/metering-balance.entity';
import { MeteringResolver } from './services/metering-resolver.service';
import { MeteringService } from './services/metering.service';
import { MeteringCleanupScheduler } from './schedulers/metering-cleanup.scheduler';
import { MeteringCleanupProcessor } from './processors/metering-cleanup.processor';

/**
 * Phase 7.18 — Metering Primitive (Part 1: engine only).
 *
 * Exports:
 *   MeteringService  — the authority every consumer calls. Wired into
 *                      Part 2 consumers (compliance, risk, AI assistant,
 *                      upload-extraction) via this exports list.
 *   MeteringResolver — exported so admin endpoints can preview "what would
 *                      reserve() do?" without a real reservation. Not used
 *                      in Part 1 outside this module.
 *
 * Part 1 ships NO controller, NO consumer wiring. The module exists; the
 * services exist; nothing calls reserve() yet. Part 2 wires consumers.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MeterDefinition,
      PlanAllowance,
      SubjectAllowance,
      MeteringLedger,
      MeteringBalance,
      Contract,
    ]),
    BullModule.registerQueue({ name: 'metering-jobs' }),
    SubscriptionsModule,
  ],
  providers: [
    MeteringResolver,
    MeteringService,
    MeteringCleanupScheduler,
    MeteringCleanupProcessor,
  ],
  exports: [MeteringService, MeteringResolver],
})
export class MeteringModule {}
