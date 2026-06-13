import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { RiskAnalysis } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2d: RiskAnalysis scoped repository.
 *
 * Resolves org via the canonical `risk_analysis → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). RiskAnalysis has NO
 * denormalized org_id / project_id column — its sole link to a tenant is the
 * `contract_id` FK — so the resolution path is inherently canonical; there is
 * no drift column to (mis)consult. The contract FK is the tenancy truth.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as ObligationScopedRepository):
 * the org-gate joins are aliased `org_gate_contract` / `org_gate_project` so
 * the base's scopedFind relation-hydration (`leftJoinAndSelect('risk.<rel>',
 * '<rel>')`) can never collide with the gate join. None of the S2d-wired risk
 * reads request a `contract` / `project` relation through scopedFind (the only
 * read needing nested relations — getByContract's `contract_clause.clause` —
 * uses the minimal-scoped-then-hydrate two-step), but the distinct gate
 * aliases keep the tenancy gate independent regardless.
 *
 * S2d wires the per-contract LIST reads through scopedFind:
 *   - RiskAnalysisService.getByContract  (two-step: scoped ids → hydrate)
 *   - RiskAnalysisService.getRiskSummary (single scopedFind, in-memory counts)
 *   - ExportService.generateContractSummary / generateRiskReport
 * The org-wide / cross-contract risk AGGREGATION query-builders
 * (dashboard-analytics, portfolio-analytics, drift-report, projects dashboard)
 * are DELIBERATELY NOT wired — they stay raw QB for the lint bucket (Q3).
 *
 * buildScopedQuery exists because the base requires it (and establishes the
 * by-id foundation), but S2d wires NO by-id risk caller — the by-id risk reads
 * (RiskExplanationService.getExplanation, RiskOverrideService.applyOverride)
 * already carry an inline canonical org join and have no separate wall to layer
 * under; centralising them is a deliberate later decision, not an S2d swap.
 *
 * The independent route walls (ContractAccessService.findInOrg at the
 * risk-analysis service layer and the export controller) STAY in front of every
 * wired read — this is the second, persona-blind tenancy layer (two checks, two
 * layers — CLAUDE.md Option B).
 */
@Injectable()
export class RiskScopedRepository extends ScopedContractRepository<RiskAnalysis> {
  // Matches the existing thrown message in risk-analysis.service / the B.3/B.5
  // inline-join loads so any future OrThrow wiring is a byte-faithful drop-in.
  // 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Risk analysis not found';
  protected readonly entityAlias = 'risk';

  // S2d allowlist: every wired risk read filters on contract_id only.
  // Widening this set is a deliberate per-bucket decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(RiskAnalysis)
    repo: Repository<RiskAnalysis>,
  ) {
    super(repo);
  }

  /**
   * `risk → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `risk.contract` FK; RiskAnalysis
   * carries no denormalized org/project column to consult.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<RiskAnalysis> {
    return this.repo
      .createQueryBuilder('risk')
      .innerJoin('risk.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<RiskAnalysis> {
    const qb = this.joinedToOrg(orgId).andWhere('risk.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`risk.contract_id`). SAFETY: the org filter
      // is ALWAYS `:orgId`; this only NARROWS to a parent contract and can
      // never widen or change the caller's org.
      qb.andWhere('risk.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<RiskAnalysis> {
    return this.joinedToOrg(orgId);
  }
}
