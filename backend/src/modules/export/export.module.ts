import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Contract,
  ContractClause,
  Clause,
  RiskAnalysis,
  Obligation,
} from '../../database/entities';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
// Tenant-isolation Tier 2 — wall every /export/contracts/:id/* read
// (pdf / risk-report / summary) via ContractAccessService.findInOrg.
// ContractsModule exports ContractAccessService.
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractClause,
      Clause,
      RiskAnalysis,
      Obligation,
    ]),
    ContractsModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
