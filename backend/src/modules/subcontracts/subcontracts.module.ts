import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubContract, SubContractStatusLog } from '../../database/entities/sub-contract.entity';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { SubContractsController } from './subcontracts.controller';
import { SubContractsService } from './subcontracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubContract, SubContractStatusLog, Contract, ProjectMember, PermissionDefault]),
    // Tenant-isolation Tier 3 — ContractAccessService is the wall for
    // POST /subcontracts + GET /subcontracts?main_contract_id=.
    ContractsModule,
  ],
  controllers: [SubContractsController],
  providers: [SubContractsService, PermissionLevelGuard],
  exports: [SubContractsService],
})
export class SubContractsModule {}
