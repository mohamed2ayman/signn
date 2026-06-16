import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { GuestInvitation } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — Chokepoint migration (guest-portal bucket, 2 of 4): GuestInvitation
 * scoped repository.
 *
 * Resolves org via the canonical `guest_invitation → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). GuestInvitation carries NO
 * denormalized org column at all (like NegotiationEvent / RiskAnalysis, unlike
 * Notice/Claim/SubContract which have a drift-prone `org_id`) — so there is no
 * drift surface here and no canonical-only/drift probe in the repo spec; the
 * `contract_id` FK is the sole tenancy truth.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as the negotiation/risk/obligation
 * scoped repos): the org-gate joins are aliased `org_gate_contract` /
 * `org_gate_project` so the base's scopedFind relation-hydration
 * (`leftJoinAndSelect('inv.<rel>', '<rel>')`) can never collide with the gate
 * join. GuestInvitation has a `contract` relation; aliasing the gate join keeps
 * it independent of any future `relations: ['contract']` hydration.
 *
 * WHAT THIS BUCKET WIRES — the by-id LOAD only. guest-portal has exactly ONE
 * request-scoped-with-an-org contract-scoped READ: GuestInvitationService.revoke
 * loads the invitation by id under a managing-user JWT (org present). That load
 * routes through {@link ScopedContractRepository.scopedFindByIdOrThrow} (the
 * no-existence-leak 404 variant). The other guest-portal bare sites are NOT
 * request-scoped reads — they are writes (create/revoke save), PUBLIC token-gated
 * paths (exchange / establish-identity / InvitationTokenService.verify — the
 * HMAC token IS the auth, no org in scope), or guest writes with no org
 * (writeGuestComment) — none can route through an org-scoped read chokepoint.
 * See docs/option-b-chokepoint-guest-portal.md.
 *
 * EMPTY ALLOWLIST: revoke is a by-id load, so no scopedFind / scopedFindAndCount
 * caller exists here. Per the base contract, a subclass with no wired list caller
 * declares an EMPTY allowedFilterKeys — any filter key throws until a future
 * bucket deliberately wires one. The list query is still implemented faithfully
 * for the base contract.
 *
 * The independent route wall (GuestInvitationService.revoke's inline
 * ContractAccessService.findInOrg on the invitation's canonical contract) STAYS
 * in front of the wired read as layer 1 — KEPT inline (NOT consolidated; the
 * create path authorizes the same way). This is the second, persona-blind
 * tenancy layer underneath it (two checks, two layers — CLAUDE.md Option B,
 * never a swap).
 */
@Injectable()
export class GuestInvitationScopedRepository extends ScopedContractRepository<GuestInvitation> {
  // Matches the existing thrown message in GuestInvitationService.revoke
  // ('Invitation not found') so the wired by-id load is a byte-faithful drop-in.
  // 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Invitation not found';
  protected readonly entityAlias = 'inv';

  // guest-portal bucket: revoke is by-id only — NO scopedFind caller. Empty set
  // until a future bucket deliberately wires a list read.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set();

  constructor(
    @InjectRepository(GuestInvitation)
    repo: Repository<GuestInvitation>,
  ) {
    super(repo);
  }

  /**
   * `inv → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `inv.contract` FK; GuestInvitation
   * carries no denormalized org column to consult.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<GuestInvitation> {
    return this.repo
      .createQueryBuilder('inv')
      .innerJoin('inv.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<GuestInvitation> {
    const qb = this.joinedToOrg(orgId).andWhere('inv.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`inv.contract_id`). SAFETY: the org filter is
      // ALWAYS `:orgId`; this only NARROWS to a parent contract and can never
      // widen or change the caller's org.
      qb.andWhere('inv.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<GuestInvitation> {
    return this.joinedToOrg(orgId);
  }
}
