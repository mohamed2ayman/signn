import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ContractParty,
  ContractPartyContact,
  Organization,
  PartyRole,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
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
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PartyRole,
      ContractParty,
      ContractPartyContact,
      Organization,
    ]),
    ContractsModule,
  ],
  controllers: [PartyRolesController, ContractPartiesController],
  providers: [PartyRolesService, ContractPartiesService],
  exports: [PartyRolesService, ContractPartiesService],
})
export class ContractPartiesModule {}
