import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
// Tenant-isolation Tier 1 — controller-level wall on body.contract_id for
// every contract-scoped AI dispatch handler. ContractsModule exports
// ContractAccessService.
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [HttpModule, ConfigModule, ContractsModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
