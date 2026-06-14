import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubContract, SubContractStatusLog } from '../../database/entities/sub-contract.entity';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { SubContractsController } from './subcontracts.controller';
import { SubContractsService } from './subcontracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractsModule } from '../contracts/contracts.module';
// Option B — S2e: SubContractsService loads its per-main-contract LIST + by-id
// surfaces through SubContractScopedRepository (data-layer tenancy chokepoint).
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubContract, SubContractStatusLog, Contract, ProjectMember, PermissionDefault]),
    // Tenant-isolation Tier 3 — ContractAccessService is the wall for
    // POST /subcontracts + GET /subcontracts?main_contract_id=.
    ContractsModule,
    ScopedRepositoryModule,
  ],
  controllers: [SubContractsController],
  providers: [SubContractsService, PermissionLevelGuard],
  exports: [SubContractsService],
})
export class SubContractsModule {}
