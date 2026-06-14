import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Claim,
  Contract,
  ContractApprover,
  ContractComment,
  ContractVersion,
  ContractorResponse,
  Notice,
  Obligation,
  RiskAnalysis,
  SubContract,
} from '../../database/entities';
import { ContractScopedRepository } from './contract-scoped.repository';
import { ContractApproverScopedRepository } from './contract-approver-scoped.repository';
import { ContractCommentScopedRepository } from './contract-comment-scoped.repository';
import { ContractVersionScopedRepository } from './contract-version-scoped.repository';
import { ContractorResponseScopedRepository } from './contractor-response-scoped.repository';
import { ObligationScopedRepository } from './obligation-scoped.repository';
import { RiskScopedRepository } from './risk-scoped.repository';
import { NoticeScopedRepository } from './notice-scoped.repository';
import { ClaimScopedRepository } from './claim-scoped.repository';
import { SubContractScopedRepository } from './subcontract-scoped.repository';

/**
 * Option B — the scoped-repository module: the data-layer tenancy chokepoint.
 *
 * S1 provided the Contract ROOT. S2a adds the first CLEAN direct-contract_id
 * CHILDREN — ContractVersion, ContractorResponse, ContractApprover — each
 * resolving org via the canonical `child → contract → project → organization_id`
 * join. S2b adds ContractComment (by-id mutation-path loads). S2c-1 adds
 * Obligation (foundation + the two clean LIST reads; by-id mutation wiring is
 * S2c-2). S2d adds RiskAnalysis. S2e adds the drift-four child entities —
 * Notice, Claim, SubContract (DocumentUpload was STOPPED; see the S2e digest —
 * its updateExtractedText path gates on the denormalized `organization_id`
 * column only, with no #57 findInOrg wall to layer under, so absorbing it would
 * be a denorm→canonical swap, not the two-layer add). The ESLint lint that bans
 * bare contract-repo access (and routes everything through this module) is the
 * final bucket.
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
      RiskAnalysis,
      Notice,
      Claim,
      SubContract,
    ]),
  ],
  providers: [
    ContractScopedRepository,
    ContractVersionScopedRepository,
    ContractorResponseScopedRepository,
    ContractApproverScopedRepository,
    ContractCommentScopedRepository,
    ObligationScopedRepository,
    RiskScopedRepository,
    NoticeScopedRepository,
    ClaimScopedRepository,
    SubContractScopedRepository,
  ],
  exports: [
    ContractScopedRepository,
    ContractVersionScopedRepository,
    ContractorResponseScopedRepository,
    ContractApproverScopedRepository,
    ContractCommentScopedRepository,
    ObligationScopedRepository,
    RiskScopedRepository,
    NoticeScopedRepository,
    ClaimScopedRepository,
    SubContractScopedRepository,
  ],
})
export class ScopedRepositoryModule {}
