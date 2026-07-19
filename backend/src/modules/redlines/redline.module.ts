import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClauseRedline, ContractClause } from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { RedlineService } from './redline.service';
import { RedlineController } from './redline.controller';

/**
 * 7.19 Slice 1 — counterparty redlining spine.
 *
 * Imports ContractsModule for ContractAccessService (the access wall:
 * org-first → binding-fallback / findInOrg) and ContractsService
 * (createVersionSnapshot — the ONE create-version entry point; the accept
 * path rides its EntityManager overload inside the redline txn). The
 * pin-guard util is pure (no DI). One-directional — ContractsModule does not
 * import this module (no cycle; the app-boot smoke test guards the wiring).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ClauseRedline, ContractClause]),
    ContractsModule,
  ],
  controllers: [RedlineController],
  providers: [RedlineService],
  exports: [RedlineService],
})
export class RedlineModule {}
