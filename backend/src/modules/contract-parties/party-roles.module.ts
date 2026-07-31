import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartyRole } from '../../database/entities';
import { PartyRolesService } from './party-roles.service';
import { PartyRolesController } from './party-roles.controller';

/**
 * Party Foundation Slice 1a — the party-role REGISTRY module.
 *
 * Extracted out of ContractPartiesModule (which still owns contract_parties
 * CRUD) for one structural reason: ContractPartiesModule imports
 * ContractsModule for the findInOrg wall, so ContractsModule cannot import it
 * back without a cycle — and Slice 1a needs the registry inside BOTH
 * ContractsModule (validating contracts.host_party_role_code) and
 * ProjectsModule (validating projects.default_party_role_code).
 *
 * This module is dependency-free, exactly like ContractRelationshipTypesModule
 * (Slice T0a) — the precedent for a registry consumed by ContractsService.
 * Three importers: ContractPartiesModule, ContractsModule, ProjectsModule.
 * No cycle; the app-boot smoke test guards the wiring.
 *
 * Registry rows are global reference data (no organization_id) — org-scoping
 * does not apply here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PartyRole])],
  controllers: [PartyRolesController],
  providers: [PartyRolesService],
  exports: [PartyRolesService],
})
export class PartyRolesModule {}
