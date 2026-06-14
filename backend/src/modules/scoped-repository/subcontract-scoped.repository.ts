import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { SubContract } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2e: SubContract scoped repository.
 *
 * Resolves org via the canonical `sub_contract → main_contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). NOTE the parent FK is
 * `main_contract_id` (the relation is `mainContract`), NOT `contract_id` — a
 * sub-contract's tenancy root is its MAIN contract. The DENORMALIZED
 * `sub_contract.org_id` column is NEVER part of the resolution path — it is a
 * non-authoritative attribution column that can drift; the `main_contract_id`
 * FK is the tenancy truth. Proven by the drifted-`org_id` probe in
 * subcontract-scoped.s2e.repository.spec.ts.
 *
 * GATE-ALIAS NOTE (deliberate, and load-bearing HERE): the org-gate joins are
 * aliased `org_gate_main_contract` / `org_gate_project`. The S2e-wired
 * sub-contract LIST read (findAllByMainContract) requests
 * `relations: ['creator', 'mainContract']` — and `mainContract` is the SAME
 * relation the gate join walks. The base's scopedFind hydrates it as
 * `leftJoinAndSelect('subcontract.mainContract', 'mainContract')`; the distinct
 * gate alias (`org_gate_main_contract`) keeps the tenancy gate join and the
 * relation-hydration join from colliding on one alias (the exact breakage the
 * ObligationScopedRepository note warned about). Both joins walk the same FK
 * under different aliases — TypeORM handles that; the resolution path stays
 * strictly canonical.
 *
 * S2e wires the per-contract LIST read (SubContractsService.findAllByMainContract)
 * through scopedFind, and the by-id loads through scopedFindByIdOrThrow:
 *   - findById (read; nested status_logs.changer relation via the two-step)
 *   - update / updateStatus / share (each its own by-id load, no relations)
 *
 * The independent #57 (S0-part-2) child-id wall (ContractAccessService.findInOrg
 * keyed on the sub-contract's OWN main_contract_id) and the Tier 3 create/list
 * wall STAY in front of every wired read — the second, persona-blind tenancy
 * layer (two checks, two layers — CLAUDE.md Option B).
 */
@Injectable()
export class SubContractScopedRepository extends ScopedContractRepository<SubContract> {
  // Matches the existing thrown message in SubContractsService so the S2e
  // OrThrow wiring is a byte-faithful drop-in. 404, never 403 — no existence
  // leak.
  protected readonly notFoundMessage = 'Subcontract not found';
  protected readonly entityAlias = 'subcontract';

  // S2e allowlist: the wired list read filters on main_contract_id only (a
  // sub-contract's parent FK). Widening this set is a deliberate per-bucket
  // decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'main_contract_id',
  ]);

  constructor(
    @InjectRepository(SubContract)
    repo: Repository<SubContract>,
  ) {
    super(repo);
  }

  /**
   * `sub_contract → main_contract → project`, both inner joins, org filter
   * mandatory. Canonical-only (Q1): the join walks the `subcontract.mainContract`
   * FK; the denormalized `subcontract.org_id` column is never consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<SubContract> {
    return this.repo
      .createQueryBuilder('subcontract')
      .innerJoin('subcontract.mainContract', 'org_gate_main_contract')
      .innerJoin('org_gate_main_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<SubContract> {
    const qb = this.joinedToOrg(orgId).andWhere('subcontract.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent MAIN contract (`subcontract.main_contract_id`). SAFETY:
      // the org filter is ALWAYS `:orgId`; this only NARROWS to a parent
      // contract and can never widen or change the caller's org.
      qb.andWhere('subcontract.main_contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<SubContract> {
    return this.joinedToOrg(orgId);
  }
}
