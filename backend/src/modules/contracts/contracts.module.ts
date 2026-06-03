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
  User,
  ContractApprover,
  GuestContractAccess,
} from '../../database/entities';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractTemplatesModule } from '../contract-templates/contract-templates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractAccessService } from './services/contract-access.service';
import { GuestPortalSchemaCheckService } from './services/guest-portal-schema-check.service';

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
      User,
      ContractApprover,
      // Phase 7.18 bucket 1a — guest binding storage.
      GuestContractAccess,
    ]),
    ContractTemplatesModule,
    NotificationsModule,
  ],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    PermissionLevelGuard,
    // Phase 7.18 bucket 1a — single contract-access authority + startup
    // schema-assert for the guest-portal spine.
    ContractAccessService,
    GuestPortalSchemaCheckService,
  ],
  exports: [ContractsService, ContractAccessService],
})
export class ContractsModule {}
