import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ComplianceCheck } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — Chokepoint migration (compliance bucket, 4 of 4 — the finale):
 * ComplianceCheck scoped repository.
 *
 * Resolves org via the canonical `compliance_check → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). ComplianceCheck has a DIRECT
 * `contract_id` FK (like ContractVersion / Obligation, unlike the transitive
 * ComplianceFinding which hangs off the check). It also carries a denormalized
 * `project_id` column — that column is NOT consulted for tenancy (Q1: drift
 * columns are non-authoritative); the gate walks the `contract` FK to the
 * project to the org. There is no `org_id` drift column to probe.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as the negotiation / risk /
 * obligation / guest-invitation scoped repos): the org-gate joins are aliased
 * `org_gate_contract` / `org_gate_project` so the base's scopedFind /
 * scopedFindAndCount relation-hydration (`leftJoinAndSelect('check.<rel>',
 * '<rel>')`) can never collide with the gate join.
 *
 * WHAT THIS BUCKET WIRES (via this subclass):
 *   - the per-contract LIST read — `ComplianceService.listForContract` routes
 *     through {@link ScopedContractRepository.scopedFindAndCount} (it takes the
 *     first 50 ordered by created_at; the org-gated count is discarded);
 *   - the by-id reads behind the controller wall — `ComplianceService.getDetail`
 *     and `ComplianceReportService.request` route through
 *     {@link ScopedContractRepository.scopedFindByIdOrThrow} (no-existence-leak
 *     404, matching the existing 'Compliance check not found' message).
 *
 * NOT wired through here (deliberate, honestly re-labelled at the sites):
 *   - `ComplianceService.refreshFromAi`'s by-id reads — the async metering-
 *     reconcile path (no request org in scope; the checkId is wall-validated
 *     upstream in `getOne` via getContractIdForCheck → findInOrg);
 *   - `ComplianceService.getContractIdForCheck` — the PRE-WALL resolver the
 *     controller calls to obtain `contract_id` BEFORE findInOrg (chicken-and-egg
 *     — it cannot itself route through a chokepoint that needs the org it is
 *     about to resolve);
 *   - `ComplianceReportProcessor`'s reads — the BullMQ system path (no request
 *     org; same posture as ObligationReminderProcessor).
 *
 * The independent inline wall (each compliance controller's
 * `assertContractInCallerOrg` → ContractAccessService.findInOrg on the check's
 * TRUE owning contract) STAYS in front of the wired reads as layer 1 — KEPT
 * inline (NOT consolidated). This is the second, persona-blind tenancy layer
 * underneath it (two checks, two layers — CLAUDE.md Option B, never a swap).
 */
@Injectable()
export class ComplianceCheckScopedRepository extends ScopedContractRepository<ComplianceCheck> {
  // Matches the existing thrown message in ComplianceService.getDetail /
  // ComplianceReportService.request ('Compliance check not found') so the wired
  // by-id loads are byte-faithful drop-ins. 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Compliance check not found';
  protected readonly entityAlias = 'check';

  // compliance bucket: listForContract filters on `contract_id` only. Widening
  // this set is a deliberate per-bucket decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(ComplianceCheck)
    repo: Repository<ComplianceCheck>,
  ) {
    super(repo);
  }

  /**
   * `check → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `check.contract` FK; the
   * denormalized `check.project_id` column is NOT consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ComplianceCheck> {
    return this.repo
      .createQueryBuilder('check')
      .innerJoin('check.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ComplianceCheck> {
    const qb = this.joinedToOrg(orgId).andWhere('check.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`check.contract_id`). SAFETY: the org filter is
      // ALWAYS `:orgId`; this only NARROWS to a parent contract and can never
      // widen or change the caller's org.
      qb.andWhere('check.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<ComplianceCheck> {
    return this.joinedToOrg(orgId);
  }
}
