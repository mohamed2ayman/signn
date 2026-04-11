import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubContract, SubContractStatusLog } from '../../database/entities/sub-contract.entity';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { SubContractsController } from './subcontracts.controller';
import { SubContractsService } from './subcontracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';

@Module({
  imports: [TypeOrmModule.forFeature([SubContract, SubContractStatusLog, Contract, ProjectMember, PermissionDefault])],
  controllers: [SubContractsController],
  providers: [SubContractsService, PermissionLevelGuard],
  exports: [SubContractsService],
})
export class SubContractsModule {}
