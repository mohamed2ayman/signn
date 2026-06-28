import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  ContractComment,
  ContractorResponse,
  Project,
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
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';
import { ContractAccessService } from './services/contract-access.service';
import { GuestPortalSchemaCheckService } from './services/guest-portal-schema-check.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Guest version review (2a/2b) — ContractsService.applyProposedVersion +
      // compareProposedVersion inject the Clause repo (parent-chain promotion).
      Clause,
      Contract,
      ContractClause,
      ContractVersion,
      ContractComment,
      ContractorResponse,
      // S0 — POST /contracts project→org ownership check (createContract walls
      // dto.project_id against the caller's org before insert).
      Project,
      ProjectMember,
      PermissionDefault,
      User,
      ContractApprover,
      // Phase 7.18 bucket 1a — guest binding storage.
      GuestContractAccess,
    ]),
    ContractTemplatesModule,
    NotificationsModule,
    // Option B — S1: the data-layer tenancy chokepoint (Contract ROOT).
    // Wired alongside — NOT in place of — ContractAccessService (the wall).
    ScopedRepositoryModule,
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
