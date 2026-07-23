import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AuditLog,
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
  GuestSignSlip,
} from '../../database/entities';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractTemplatesModule } from '../contract-templates/contract-templates.module';
import { ContractRelationshipTypesModule } from '../contract-relationship-types/contract-relationship-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';
import { ContractAccessService } from './services/contract-access.service';
import { ContractPinningService } from './services/contract-pinning.service';
import { GuestSignSlipService } from './services/guest-sign-slip.service';
import { GuestPortalSchemaCheckService } from './services/guest-portal-schema-check.service';
import { NegotiationStatusService } from './services/negotiation-status.service';
import { NegotiationStatusController } from './negotiation-status.controller';

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
      // Guest Signing v1 — the SLIP capability records.
      GuestSignSlip,
      // Signed-state pinning (Slice 1) — ContractPinningService's best-effort
      // pin audit write.
      AuditLog,
    ]),
    ContractTemplatesModule,
    NotificationsModule,
    // Option B — S1: the data-layer tenancy chokepoint (Contract ROOT).
    // Wired alongside — NOT in place of — ContractAccessService (the wall).
    ScopedRepositoryModule,
    // Multi-tier trunk T0a — ContractsService.create() validates
    // dto.relationship_type against ACTIVE registry codes.
    ContractRelationshipTypesModule,
  ],
  controllers: [ContractsController, NegotiationStatusController],
  providers: [
    ContractsService,
    PermissionLevelGuard,
    // Phase 7.18 bucket 1a — single contract-access authority + startup
    // schema-assert for the guest-portal spine.
    ContractAccessService,
    // Signed-state pinning (Slice 1) — the ONE shared pin operation both
    // execution doors funnel through (DocuSign webhook + manual mark-signed).
    ContractPinningService,
    // Guest Signing v1 — slip issuance/list/void (host) + the binding+slip
    // guest door (consumed by guest-portal's GuestSignController).
    GuestSignSlipService,
    // 7.19 Slice 2 — the negotiation status machine (SEPARATE lane from the
    // lifecycle status; also consumed by RedlineModule's propose auto-hook).
    NegotiationStatusService,
    GuestPortalSchemaCheckService,
  ],
  exports: [
    ContractsService,
    ContractAccessService,
    ContractPinningService,
    GuestSignSlipService,
    NegotiationStatusService,
  ],
})
export class ContractsModule {}
