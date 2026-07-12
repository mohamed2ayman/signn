import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { RiskAnalysis, RiskClauseVisibility } from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { RiskScopedRepository } from '../../scoped-repository/risk-scoped.repository';
import { computeDefaultVisibleIds, resolveVisibleIds } from '../utils/risk-visibility.util';

/**
 * Risk-tab clutter reduction — the VISIBLE-set authority.
 *
 * The Risk tab shows the top-2 risks per clause by default (severity + distinct
 * — utils/risk-visibility.util). A human can SWAP a hidden risk into the visible
 * pair; that choice is persisted per clause (RiskClauseVisibility) and MUST be
 * respected by completeness + the gold export (STEP 4). This service is the one
 * place that resolves "which 2 are visible" server-side.
 *
 * A risk is VERIFIED when a human corrected it (`is_edited_by_user = true`). NB
 * (investigation C3): this only fires on an EDIT — a human who reviews a top-2
 * risk and agrees WITHOUT changing it leaves no marker; that gap is the
 * documented limit of the current signal.
 */
@Injectable()
export class RiskVisibilityService {
  constructor(
    @InjectRepository(RiskClauseVisibility)
    private readonly visRepo: Repository<RiskClauseVisibility>,
    @InjectRepository(RiskAnalysis) // lint-exempt: wall-protected (findInOrg) + is_deleted-filtered per-clause reads
    private readonly riskRepo: Repository<RiskAnalysis>,
    private readonly riskScoped: RiskScopedRepository,
    private readonly contractAccess: ContractAccessService,
  ) {}

  /** Load the live (non-deleted) risks of a contract, grouped by clause id. */
  private async liveRisksByClause(
    contractId: string,
    orgId: string,
  ): Promise<Map<string, RiskAnalysis[]>> {
    const scoped = await this.riskScoped.scopedFind({ contract_id: contractId }, orgId);
    const byClause = new Map<string, RiskAnalysis[]>();
    for (const r of scoped) {
      if (r.is_deleted || !r.contract_clause_id) continue;
      let arr = byClause.get(r.contract_clause_id);
      if (!arr) {
        arr = [];
        byClause.set(r.contract_clause_id, arr);
      }
      arr.push(r);
    }
    return byClause;
  }

  private async overridesFor(clauseIds: string[]): Promise<Map<string, string[]>> {
    if (!clauseIds.length) return new Map();
    const rows = await this.visRepo.find({ where: { contract_clause_id: In(clauseIds) } });
    return new Map(rows.map((r) => [r.contract_clause_id, r.visible_risk_ids]));
  }

  /**
   * Per-contract override map: { [contract_clause_id]: [visibleId, visibleId] }
   * — ONLY clauses that have a stored swap override (clauses without one use the
   * frontend's own default). Walled + is_deleted-aware.
   */
  async getOverrides(contractId: string, orgId: string): Promise<Record<string, string[]>> {
    await this.contractAccess.findInOrg(contractId, orgId);
    const byClause = await this.liveRisksByClause(contractId, orgId);
    const overrides = await this.overridesFor([...byClause.keys()]);
    const out: Record<string, string[]> = {};
    for (const [clauseId, risks] of byClause) {
      const ov = overrides.get(clauseId);
      if (!ov) continue; // no override → frontend uses its default
      // Resolve against live risks so a stale id can't leak.
      out[clauseId] = resolveVisibleIds(risks, ov);
    }
    return out;
  }

  /**
   * Completeness: annotation is COMPLETE when every VISIBLE risk (the top-2 per
   * clause after any swaps, excluding soft-deleted) is human-verified.
   * Hidden risks are never required. Returns counts + the incomplete clauses.
   */
  async getCompleteness(
    contractId: string,
    orgId: string,
  ): Promise<{
    complete: boolean;
    clauses: number;
    visible_total: number;
    visible_verified: number;
    visible_unverified: number;
    hidden_total: number;
    incomplete_clause_ids: string[];
  }> {
    await this.contractAccess.findInOrg(contractId, orgId);
    const byClause = await this.liveRisksByClause(contractId, orgId);
    const overrides = await this.overridesFor([...byClause.keys()]);

    let visibleTotal = 0;
    let visibleVerified = 0;
    let hiddenTotal = 0;
    const incomplete: string[] = [];

    for (const [clauseId, risks] of byClause) {
      const visibleIds = new Set(resolveVisibleIds(risks, overrides.get(clauseId) ?? null));
      let clauseComplete = true;
      for (const r of risks) {
        if (visibleIds.has(r.id)) {
          visibleTotal++;
          if (r.is_edited_by_user) visibleVerified++;
          else clauseComplete = false;
        } else {
          hiddenTotal++;
        }
      }
      if (!clauseComplete) incomplete.push(clauseId);
    }

    return {
      complete: incomplete.length === 0,
      clauses: byClause.size,
      visible_total: visibleTotal,
      visible_verified: visibleVerified,
      visible_unverified: visibleTotal - visibleVerified,
      hidden_total: hiddenTotal,
      incomplete_clause_ids: incomplete,
    };
  }

  /**
   * Persist a SWAP: set exactly 2 chosen visible risk ids for a clause. Both ids
   * must be live (non-deleted) risks of THAT clause. Walled via the clause's
   * contract. Display/selection only — never mutates any risk's data.
   */
  async setVisibility(
    contractClauseId: string,
    visibleRiskIds: string[],
    orgId: string,
    userId: string,
  ): Promise<RiskClauseVisibility> {
    if (!Array.isArray(visibleRiskIds) || visibleRiskIds.length !== 2 || visibleRiskIds[0] === visibleRiskIds[1]) {
      throw new BadRequestException('visible_risk_ids must be exactly 2 distinct risk ids');
    }
    const risks = await this.riskRepo.find({ // lint-exempt: wall-protected below (findInOrg) — clause-scoped read
      where: { contract_clause_id: contractClauseId, is_deleted: false },
    });
    if (risks.length === 0) {
      throw new NotFoundException('No risks for this clause');
    }
    // WALL: every row shares one contract_id (a clause belongs to one contract).
    await this.contractAccess.findInOrg(risks[0].contract_id, orgId);

    const live = new Set(risks.map((r) => r.id));
    for (const id of visibleRiskIds) {
      if (!live.has(id)) {
        throw new BadRequestException('visible_risk_ids must be live risks of this clause');
      }
    }

    await this.visRepo.upsert(
      {
        contract_clause_id: contractClauseId,
        visible_risk_ids: visibleRiskIds,
        updated_by: userId,
      },
      ['contract_clause_id'],
    );
    return this.visRepo.findOneOrFail({ where: { contract_clause_id: contractClauseId } });
  }

  /** Exposed for tests/tools: the deterministic default (no override). */
  defaultVisible(risks: RiskAnalysis[]): string[] {
    return computeDefaultVisibleIds(risks);
  }
}
