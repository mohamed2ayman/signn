import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ComplianceFinding } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — Chokepoint migration (compliance bucket, 4 of 4 — the finale):
 * ComplianceFinding scoped repository.
 *
 * TRANSITIVE child: ComplianceFinding has NO direct `contract_id` — it hangs off
 * its parent ComplianceCheck. Org resolves via the canonical
 * `compliance_finding → compliance_check → contract → project → organization_id`
 * chain ONLY (Ayman B spec Q1). One extra join hop versus the direct-contract_id
 * children; otherwise identical shape. No denormalized org/contract column on the
 * finding — there is no drift surface.
 *
 * GATE-ALIAS NOTE: the org-gate joins are aliased `org_gate_check` /
 * `org_gate_contract` / `org_gate_project` so the base's scopedFind
 * relation-hydration can never collide with the gate join.
 *
 * WHAT THIS BUCKET WIRES (via this subclass): the by-id read behind the
 * controller wall — `ComplianceFindingService.updateStatus` routes the finding
 * load through {@link ScopedContractRepository.scopedFindByIdOrThrow} (the
 * no-existence-leak 404, matching the existing 'Finding not found' message)
 * BEFORE the status mutation. The controller resolves the finding's owning
 * contract_id (getContractIdForFinding) and walls on it (layer 1); this is the
 * persona-blind data-layer tenancy gate underneath (layer 2 — two checks, two
 * layers, never a swap).
 *
 * NOT wired through here (deliberate, honestly re-labelled at the sites):
 *   - `ComplianceService.getDetail`'s findings-by-check_id list — TWO-STEP: the
 *     parent check is scoped-loaded on the line directly above, so the findings
 *     list is keyed by an already-validated check id (no grandchild scoped
 *     subclass needed, same posture as the obligation reminder-log list);
 *   - `ComplianceFindingService.getContractIdForFinding` — the PRE-WALL resolver
 *     the controller calls to obtain contract_id BEFORE findInOrg;
 *   - `ComplianceFindingService.listForCheck` — currently DEAD CODE (no caller);
 *   - `ComplianceReportProcessor`'s findings reads — the BullMQ system path.
 *
 * EMPTY ALLOWLIST: updateStatus is a by-id load — there is NO scopedFind caller
 * here. Per the base contract, a subclass with no wired list caller declares an
 * EMPTY allowedFilterKeys: every filter key throws until a future bucket
 * deliberately wires one. The list query is still implemented faithfully for the
 * base contract.
 */
@Injectable()
export class ComplianceFindingScopedRepository extends ScopedContractRepository<ComplianceFinding> {
  // Matches the existing thrown message in ComplianceFindingService.updateStatus
  // ('Finding not found') so the wired by-id load is a byte-faithful drop-in.
  // 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Finding not found';
  protected readonly entityAlias = 'finding';

  // compliance bucket: updateStatus is by-id only — NO scopedFind caller. Empty
  // set until a future bucket deliberately wires a list read.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set();

  constructor(
    @InjectRepository(ComplianceFinding)
    repo: Repository<ComplianceFinding>,
  ) {
    super(repo);
  }

  /**
   * `finding → compliance_check → contract → project`, all inner joins, org
   * filter mandatory. Canonical-only (Q1): the join walks the
   * `finding.compliance_check` FK then the check's `contract` FK.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ComplianceFinding> {
    return this.repo
      .createQueryBuilder('finding')
      .innerJoin('finding.compliance_check', 'org_gate_check')
      .innerJoin('org_gate_check.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ComplianceFinding> {
    const qb = this.joinedToOrg(orgId).andWhere('finding.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract via the check's `contract_id`. SAFETY: the org
      // filter is ALWAYS `:orgId`; this only NARROWS to a parent contract and
      // can never widen or change the caller's org.
      qb.andWhere('org_gate_check.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<ComplianceFinding> {
    return this.joinedToOrg(orgId);
  }
}
