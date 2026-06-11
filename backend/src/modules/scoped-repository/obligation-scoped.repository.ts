import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { Obligation } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2c-1: Obligation scoped repository (FOUNDATION).
 *
 * Resolves org via the canonical `obligation → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). The denormalized
 * `obligation.project_id` column is NEVER part of the resolution path — it is
 * a non-authoritative fast-path column for project-level queries and can
 * drift; the contract FK is the tenancy truth. Proven by the wrong-project_id
 * probe in obligation-scoped.s2c1.repository.spec.ts.
 *
 * GATE-ALIAS NOTE (deliberate deviation from the version/comment template):
 * the org-gate joins are aliased `org_gate_contract` / `org_gate_project`
 * instead of the template's `contract` / `project`. The base's scopedFind
 * hydrates caller-requested relations as
 * `leftJoinAndSelect('obligation.<relation>', '<relation>')` — and the FIRST
 * wired obligation list read (icalForContract) requests `relations:
 * ['contract']`. With the template aliases, that hydration join would collide
 * with the gate join ("contract" registered twice → broken SQL). Distinct
 * gate aliases keep the tenancy gate and relation hydration independent; the
 * resolution path is still strictly canonical.
 *
 * S2c-1 wires ONLY the two clean LIST reads (export contract-summary
 * obligations read; ical export read) through scopedFind. The by-id mutation
 * surface (obligations.service findById/update/complete/delete, the
 * controller's loadObligationInContract) is S2c-2 — buildScopedQuery exists
 * because the base requires it and to establish the foundation, but no by-id
 * caller is wired here. The independent #60/S0 walls
 * (assertContractInCallerOrg / findInOrg) stay in front of every wired read;
 * this is the second, persona-blind tenancy layer (two checks, two layers —
 * CLAUDE.md Option B).
 */
@Injectable()
export class ObligationScopedRepository extends ScopedContractRepository<Obligation> {
  // Matches the existing thrown message in obligations.service (findById) so
  // future S2c-2 OrThrow wiring is a byte-faithful drop-in. 404, never 403 —
  // no existence leak.
  protected readonly notFoundMessage = 'Obligation not found';
  protected readonly entityAlias = 'obligation';

  // S2c-1 allowlist: the two wired list reads filter on contract_id only.
  // Widening this set is a deliberate per-bucket decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(Obligation)
    repo: Repository<Obligation>,
  ) {
    super(repo);
  }

  /**
   * `obligation → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the contract FK; `obligation.project_id`
   * is never consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<Obligation> {
    return this.repo
      .createQueryBuilder('obligation')
      .innerJoin('obligation.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<Obligation> {
    const qb = this.joinedToOrg(orgId).andWhere('obligation.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // CHILD override pins the PARENT contract (`obligation.contract_id`).
      // SAFETY: the org filter is ALWAYS `:orgId`; this only NARROWS to a
      // parent contract and can never widen or change the caller's org.
      qb.andWhere('obligation.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<Obligation> {
    return this.joinedToOrg(orgId);
  }
}
