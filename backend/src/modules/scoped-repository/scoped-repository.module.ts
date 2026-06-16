import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Claim,
  Contract,
  ContractApprover,
  ContractComment,
  ContractVersion,
  ContractorResponse,
  DocumentUpload,
  GuestInvitation,
  NegotiationEvent,
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
import { DocumentUploadScopedRepository } from './document-upload-scoped.repository';
import { NegotiationEventScopedRepository } from './negotiation-event-scoped.repository';
import { GuestInvitationScopedRepository } from './guest-invitation-scoped.repository';

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
 * column only, with no #57 findInOrg wall to layer under, so absorbing it then
 * would have been a denorm→canonical swap, not the two-layer add). S2f adds
 * DocumentUpload the correct way: Phase 1 first walled updateExtractedText with
 * the canonical findInOrg, THEN this module adds the scoped chokepoint
 * underneath (the two clean request-scoped reads — getDocuments + the
 * now-walled updateExtractedText). Its metering-entangled paths
 * (pollAndAdvance/reprocess) are deferred (the dead getDocumentStatus service
 * method was removed in the S2f follow-up cleanup);
 * see docs/option-b-s2f-document-upload-recon.md. The ESLint lint that bans
 * bare contract-repo access (and routes everything through this module) shipped
 * after S2f and is now CI-enforced.
 *
 * CHOKEPOINT MIGRATION (post-lint, 1 of 4) adds NegotiationEvent — the first of
 * the four modules the lint surfaced as "wall-protected; chokepoint migration
 * scheduled" (negotiation/guest-portal/chat/compliance). It wires
 * NegotiationService.findHistory (a paginated per-contract LIST read) through
 * the NEW paginated scopedFindAndCount, under the module's own inline
 * assertContractInOrg wall (KEPT inline, not consolidated into findInOrg). See
 * docs/option-b-chokepoint-negotiation.md.
 *
 * Chokepoint migration (2 of 4) adds GuestInvitation — guest-portal's single
 * request-scoped-with-an-org read: GuestInvitationService.revoke's by-id load,
 * wired through scopedFindByIdOrThrow under the inline findInOrg wall (KEPT
 * inline). guest-portal's other bare sites are writes / PUBLIC token-gated paths
 * (exchange / establish-identity / token-verify) / guest-no-org writes — none is
 * an org-scoped read, so none routes through the chokepoint (they stay bare with
 * honest permanent lint-exempt reasons). The viewer-credential surface has NO
 * bare guest-portal read at all — its contract load delegates to the
 * findAccessibleContract wall. See docs/option-b-chokepoint-guest-portal.md.
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
      DocumentUpload,
      NegotiationEvent,
      GuestInvitation,
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
    DocumentUploadScopedRepository,
    NegotiationEventScopedRepository,
    GuestInvitationScopedRepository,
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
    DocumentUploadScopedRepository,
    NegotiationEventScopedRepository,
    GuestInvitationScopedRepository,
  ],
})
export class ScopedRepositoryModule {}
