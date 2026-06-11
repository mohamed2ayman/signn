import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Contract,
  ContractApprover,
  ContractComment,
  ContractVersion,
  ContractorResponse,
  Obligation,
} from '../../database/entities';
import { ContractScopedRepository } from './contract-scoped.repository';
import { ContractApproverScopedRepository } from './contract-approver-scoped.repository';
import { ContractCommentScopedRepository } from './contract-comment-scoped.repository';
import { ContractVersionScopedRepository } from './contract-version-scoped.repository';
import { ContractorResponseScopedRepository } from './contractor-response-scoped.repository';
import { ObligationScopedRepository } from './obligation-scoped.repository';

/**
 * Option B — the scoped-repository module: the data-layer tenancy chokepoint.
 *
 * S1 provided the Contract ROOT. S2a adds the first CLEAN direct-contract_id
 * CHILDREN — ContractVersion, ContractorResponse, ContractApprover — each
 * resolving org via the canonical `child → contract → project → organization_id`
 * join. S2b adds ContractComment (by-id mutation-path loads). S2c-1 adds
 * Obligation (foundation + the two clean LIST reads; by-id mutation wiring is
 * S2c-2). More child-entity scoped repositories are added here in later buckets
 * (S2c-2–S2e); the ESLint lint that bans bare contract-repo access (and routes
 * everything through this module) is the final bucket.
 *
 * Consumers import THIS module and inject the scoped repositories — they do NOT
 * inject `@InjectRepository(Contract|ContractVersion|…)` for tenancy-scoped
 * loads. The walls (`ContractAccessService`, the S0 interim walls) stay where
 * they are and are unaffected.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractVersion,
      ContractorResponse,
      ContractApprover,
      ContractComment,
      Obligation,
    ]),
  ],
  providers: [
    ContractScopedRepository,
    ContractVersionScopedRepository,
    ContractorResponseScopedRepository,
    ContractApproverScopedRepository,
    ContractCommentScopedRepository,
    ObligationScopedRepository,
  ],
  exports: [
    ContractScopedRepository,
    ContractVersionScopedRepository,
    ContractorResponseScopedRepository,
    ContractApproverScopedRepository,
    ContractCommentScopedRepository,
    ObligationScopedRepository,
  ],
})
export class ScopedRepositoryModule {}
