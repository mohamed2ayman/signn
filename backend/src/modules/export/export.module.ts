import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Contract,
  ContractClause,
  Clause,
} from '../../database/entities';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
// Tenant-isolation Tier 2 — wall every /export/contracts/:id/* read
// (pdf / risk-report / summary) via ContractAccessService.findInOrg.
// ContractsModule exports ContractAccessService.
import { ContractsModule } from '../contracts/contracts.module';
// Option B — S2c-1: the summary's obligations read loads through the
// Obligation scoped repository (data-layer tenancy chokepoint). The bare
// Obligation forFeature registration is gone with it.
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractClause,
      Clause,
    ]),
    ContractsModule,
    ScopedRepositoryModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
