import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { Claim } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2e: Claim scoped repository.
 *
 * Resolves org via the canonical `claim → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). The DENORMALIZED
 * `claim.org_id` column is NEVER part of the resolution path — it is a
 * non-authoritative attribution column that can drift; the `contract_id` FK is
 * the tenancy truth. Proven by the drifted-`org_id` probe in
 * claim-scoped.s2e.repository.spec.ts.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as ObligationScopedRepository /
 * RiskScopedRepository): the org-gate joins are aliased `org_gate_contract` /
 * `org_gate_project` so the base's scopedFind relation-hydration
 * (`leftJoinAndSelect('claim.<rel>', '<rel>')`) can never collide with the gate
 * join. The S2e-wired claim LIST read (findAllByContract) requests
 * `relations: ['submitter', 'documents']` — no overlap with the gate aliases.
 *
 * S2e wires the per-contract LIST read (ClaimsService.findAllByContract) through
 * scopedFind, and the by-id loads through scopedFindByIdOrThrow:
 *   - ClaimsService.findById (the shared loader for acknowledge/respond/
 *     updateStatus — nested-relation hydration via the two-step)
 *   - ClaimsService.uploadDocument (its own by-id load, no relations)
 *
 * The independent #57 (S0-part-2) child-id wall (ContractAccessService.findInOrg
 * keyed on the claim's OWN contract_id) and the Tier 3 create/list wall STAY in
 * front of every wired read — the second, persona-blind tenancy layer (two
 * checks, two layers — CLAUDE.md Option B).
 */
@Injectable()
export class ClaimScopedRepository extends ScopedContractRepository<Claim> {
  // Matches the existing thrown message in ClaimsService so the S2e OrThrow
  // wiring is a byte-faithful drop-in. 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Claim not found';
  protected readonly entityAlias = 'claim';

  // S2e allowlist: the wired list read filters on contract_id only.
  // Widening this set is a deliberate per-bucket decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(Claim)
    repo: Repository<Claim>,
  ) {
    super(repo);
  }

  /**
   * `claim → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `claim.contract` FK; the
   * denormalized `claim.org_id` column is never consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<Claim> {
    return this.repo
      .createQueryBuilder('claim')
      .innerJoin('claim.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<Claim> {
    const qb = this.joinedToOrg(orgId).andWhere('claim.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`claim.contract_id`). SAFETY: the org filter
      // is ALWAYS `:orgId`; this only NARROWS to a parent contract and can
      // never widen or change the caller's org.
      qb.andWhere('claim.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<Claim> {
    return this.joinedToOrg(orgId);
  }
}
