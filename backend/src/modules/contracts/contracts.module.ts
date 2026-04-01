import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Contract,
  ContractClause,
  ContractVersion,
  ContractComment,
  ContractorResponse,
  ProjectMember,
  PermissionDefault,
} from '../../database/entities';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractTemplatesModule } from '../contract-templates/contract-templates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractClause,
      ContractVersion,
      ContractComment,
      ContractorResponse,
      ProjectMember,
      PermissionDefault,
    ]),
    ContractTemplatesModule,
  ],
  controllers: [ContractsController],
  providers: [ContractsService, PermissionLevelGuard],
  exports: [ContractsService],
})
export class ContractsModule {}
