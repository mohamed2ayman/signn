import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Contract,
  ContractParty,
  ContractPartyContact,
  Obligation,
  Organization,
  PermissionDefault,
  ProjectMember,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ResolveObligationProjectMiddleware } from '../../common/middleware/resolve-obligation-project.middleware';
import { PartyRolesModule } from './party-roles.module';
import { ContractPartiesService } from './contract-parties.service';
import { ContractPartiesController } from './contract-parties.controller';

/**
 * Multi-tier trunk — Slice T0c-1. Contract parties CRUD.
 *
 * The party-role REGISTRY (PartyRolesService + GET /party-roles) moved out to
 * the dependency-free PartyRolesModule in Party Foundation Slice 1a; this
 * module imports and re-exports it, so existing importers are unaffected.
 *
 * Imports ContractsModule for ContractAccessService (the findInOrg tenancy
 * wall). One-directional — ContractsModule does not import this module
 * (no cycle; the app-boot smoke test guards the wiring).
 *
 * Party MUTATIONS are floored at EDITOR via the Phase 7.15 obligation stack:
 * PermissionLevelGuard (needs ProjectMember + PermissionDefault repos) +
 * ResolveObligationProjectMiddleware (needs Contract + Obligation repos; its
 * contracts/:contractId branch resolves params.project_id for the guard).
 * ComplianceModule already applies the same middleware to 'contracts' routes;
 * the middleware is idempotent (skips when project_id is already resolved),
 * so this module registers it for ITS OWN routes rather than relying on
 * another module's registration.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContractParty,
      ContractPartyContact,
      Organization,
      // PermissionLevelGuard dependencies:
      ProjectMember,
      PermissionDefault,
      // ResolveObligationProjectMiddleware dependencies:
      Contract,
      Obligation,
    ]),
    ContractsModule,
    // Party Foundation Slice 1a — the registry (service + GET /party-roles)
    // moved to its own dependency-free module so ContractsModule and
    // ProjectsModule can import it without a cycle through this module's
    // ContractsModule import. ContractPartiesService still consumes
    // PartyRolesService for role_code validation, now via this import.
    PartyRolesModule,
  ],
  controllers: [ContractPartiesController],
  providers: [
    ContractPartiesService,
    PermissionLevelGuard,
    ResolveObligationProjectMiddleware,
  ],
  // PartyRolesModule is re-exported so existing importers that relied on this
  // module for PartyRolesService keep resolving it unchanged.
  exports: [PartyRolesModule, ContractPartiesService],
})
export class ContractPartiesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ResolveObligationProjectMiddleware)
      .forRoutes(ContractPartiesController);
  }
}
