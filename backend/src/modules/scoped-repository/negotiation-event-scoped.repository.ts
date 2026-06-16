import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { NegotiationEvent } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — Chokepoint migration (negotiation bucket, 1 of 4): NegotiationEvent
 * scoped repository.
 *
 * Resolves org via the canonical `negotiation_event → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). NegotiationEvent carries NO
 * denormalized org column at all (unlike Notice/Claim/SubContract, which have a
 * drift-prone `org_id`) — so there is no drift surface here and no
 * canonical-only/drift probe in the repo spec; the `contract_id` FK is the sole
 * tenancy truth.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as Notice/Claim/SubContract/
 * Obligation/Risk scoped repos): the org-gate joins are aliased
 * `org_gate_contract` / `org_gate_project` so the base's scopedFind/
 * scopedFindAndCount relation-hydration (`leftJoinAndSelect('event.<rel>',
 * '<rel>')`) can never collide with the gate join. The wired findHistory read
 * requests `relations: ['performer']` — no overlap with the gate aliases — but
 * the distinct gate aliases keep the tenancy gate independent regardless.
 *
 * This bucket wires the per-contract LIST read (NegotiationService.findHistory)
 * through the NEW paginated {@link ScopedContractRepository.scopedFindAndCount}
 * (findHistory returns `{ events, total }` via `getManyAndCount` + take/skip,
 * which the non-paginated scopedFind cannot express). negotiation has NO by-id
 * read, so no scopedFind*ById* caller exists here — but the by-id query is
 * implemented faithfully for the base contract and future use.
 *
 * The independent inline wall (NegotiationService.assertContractInOrg — the
 * home-grown canonical `contract → project → org` no-leak 404 gate) STAYS in
 * front of the wired read as layer 1. The negotiation bucket KEEPS that wall
 * inline (it is NOT consolidated into ContractAccessService.findInOrg): the two
 * enforce the identical gate, and folding findInOrg in would run a heavier
 * hydrating load whose result findHistory discards plus add a cross-module
 * dependency. This is the second, persona-blind tenancy layer underneath it
 * (two checks, two layers — CLAUDE.md Option B, never a swap).
 */
@Injectable()
export class NegotiationEventScopedRepository extends ScopedContractRepository<NegotiationEvent> {
  // No by-id OrThrow caller exists in negotiation today; the message matches the
  // no-existence-leak convention (404, never 403) for the faithful base contract.
  protected readonly notFoundMessage = 'Negotiation event not found';
  protected readonly entityAlias = 'event';

  // Negotiation bucket allowlist: findHistory filters on contract_id (always)
  // and clause_ref (optional). Widening this set is a deliberate per-bucket
  // decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
    'clause_ref',
  ]);

  constructor(
    @InjectRepository(NegotiationEvent)
    repo: Repository<NegotiationEvent>,
  ) {
    super(repo);
  }

  /**
   * `event → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `event.contract` FK; no denormalized
   * org column exists to consult.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<NegotiationEvent> {
    return this.repo
      .createQueryBuilder('event')
      .innerJoin('event.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<NegotiationEvent> {
    const qb = this.joinedToOrg(orgId).andWhere('event.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`event.contract_id`). SAFETY: the org filter is
      // ALWAYS `:orgId`; this only NARROWS to a parent contract and can never
      // widen or change the caller's org.
      qb.andWhere('event.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<NegotiationEvent> {
    return this.joinedToOrg(orgId);
  }
}
