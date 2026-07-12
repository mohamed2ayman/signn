import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Contract,
  ContractParty,
  ContractPartyContact,
  Obligation,
  Organization,
  PartyRole,
  PermissionDefault,
  ProjectMember,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ResolveObligationProjectMiddleware } from '../../common/middleware/resolve-obligation-project.middleware';
import { PartyRolesService } from './party-roles.service';
import { PartyRolesController } from './party-roles.controller';
import { ContractPartiesService } from './contract-parties.service';
import { ContractPartiesController } from './contract-parties.controller';

/**
 * Multi-tier trunk — Slice T0c-1. Contract parties + the party-role registry.
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
      PartyRole,
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
  ],
  controllers: [PartyRolesController, ContractPartiesController],
  providers: [
    PartyRolesService,
    ContractPartiesService,
    PermissionLevelGuard,
    ResolveObligationProjectMiddleware,
  ],
  exports: [PartyRolesService, ContractPartiesService],
})
export class ContractPartiesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ResolveObligationProjectMiddleware)
      .forRoutes(ContractPartiesController);
  }
}
