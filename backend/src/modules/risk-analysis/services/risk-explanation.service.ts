import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  RiskAnalysis,
  RiskAnalysisOverrideLog,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
  User,
} from '../../../database/entities';
import { RiskSourceType } from '../enums/risk-source-type.enum';
import { RiskMethodologyResolverService } from './risk-methodology-resolver.service';

/**
 * Phase 7.17 — Prompt 1, B.5.
 *
 * Read-side provenance service for a single risk finding. Backs the F.1
 * "why?" explanation popover via `GET /risk-analysis/:id/explanation`.
 *
 * `getExplanation()` performs THREE reads and no writes:
 *   1. The finding itself, org-scoped through contract→project→org
 *      (404 if the finding isn't in the caller's org — same ownership
 *      pattern as B.3's override service).
 *   2. A resolver snapshot — "what would the chain return RIGHT NOW for a
 *      fresh finding in this (org, category)" — for the UI to contrast the
 *      current stored value against the live default. Uses the resolver's
 *      5-min read-through cache.
 *   3. The override history for this finding, newest-first, with the
 *      overriding user left-joined for display attribution.
 *
 * No pagination in v1 — the full history is returned (a single finding
 * accumulates very few overrides).
 */
@Injectable()
export class RiskExplanationService {
  constructor(
    @InjectRepository(RiskAnalysis)
    private readonly riskRepo: Repository<RiskAnalysis>,
    private readonly resolver: RiskMethodologyResolverService,
    @InjectRepository(RiskCategoryPlatformDefault)
    private readonly platformDefaultRepo: Repository<RiskCategoryPlatformDefault>,
    @InjectRepository(RiskCategoryOrgLearnedBaseline)
    private readonly baselineRepo: Repository<RiskCategoryOrgLearnedBaseline>,
    @InjectRepository(RiskAnalysisOverrideLog)
    private readonly overrideLogRepo: Repository<RiskAnalysisOverrideLog>,
  ) {}

  async getExplanation(
    riskId: string,
    orgId: string,
  ): Promise<RiskExplanation> {
    // 1. Load the finding, org-scoped (404 if not in caller's org).
    const risk = await this.riskRepo
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('r.id = :riskId', { riskId })
      .andWhere('p.organization_id = :orgId', { orgId })
      .getOne();
    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }

    // 2. Resolver snapshot — what would resolve right now for this
    //    (org, category). Uses the 5-min cache.
    const resolved = await this.resolver.resolveDefaults({
      organizationId: orgId,
      riskCategory: risk.risk_category,
    });

    // 3. Citation + learned-baseline-count enrichment.
    let citation: { short: string; full: string } | undefined;
    let learnedBaselineCount: number | undefined;
    if (
      resolved.likelihood_source === RiskSourceType.PLATFORM_DEFAULT &&
      resolved.platform_default_ref_id
    ) {
      const pd = await this.platformDefaultRepo.findOne({
        where: { id: resolved.platform_default_ref_id },
      });
      if (pd) {
        citation = {
          short: pd.apa_citation_short,
          full: pd.apa_citation_full,
        };
      }
    } else if (resolved.likelihood_source === RiskSourceType.ORG_LEARNED) {
      const baseline = await this.baselineRepo.findOne({
        where: { organization_id: orgId, risk_category: risk.risk_category },
      });
      if (baseline) {
        learnedBaselineCount = baseline.override_count;
      }
    }

    // 4. Override history — newest first, LEFT JOIN users for display name.
    const logRows = await this.overrideLogRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.risk_analysis_id = :riskId', { riskId })
      .orderBy('o.created_at', 'DESC')
      .getMany();

    return {
      current: {
        likelihood: risk.likelihood,
        impact: risk.impact,
        risk_score: risk.risk_score,
        likelihood_source: risk.likelihood_source,
        impact_source: risk.impact_source,
      },
      resolution: {
        likelihood: resolved.likelihood,
        impact: resolved.impact,
        source: resolved.likelihood_source,
        citation,
        learned_baseline_count: learnedBaselineCount,
      },
      override_history: logRows.map((o) => ({
        overridden_at: o.created_at,
        overridden_by: o.user
          ? { id: o.user.id, display_name: this.displayName(o.user) }
          : { id: o.user_id ?? '', display_name: null },
        previous_likelihood: o.previous_likelihood,
        previous_impact: o.previous_impact,
        new_likelihood: o.new_likelihood,
        new_impact: o.new_impact,
        previous_source: o.previous_source,
        note: o.note,
      })),
    };
  }

  private displayName(u: User): string | null {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    return name || u.email || null;
  }
}

// ─── Public types ─────────────────────────────────────────────────────────

export interface RiskExplanationCurrent {
  likelihood: number;
  impact: number;
  risk_score: number;
  likelihood_source: RiskSourceType;
  impact_source: RiskSourceType;
}

export interface RiskExplanationResolution {
  likelihood: number;
  impact: number;
  source: RiskSourceType;
  /** Present only when the live resolution source is PLATFORM_DEFAULT. */
  citation?: { short: string; full: string };
  /** Present only when the live resolution source is ORG_LEARNED. */
  learned_baseline_count?: number;
}

export interface RiskExplanationOverrideRow {
  overridden_at: Date;
  overridden_by: { id: string; display_name: string | null };
  previous_likelihood: number;
  previous_impact: number;
  new_likelihood: number;
  new_impact: number;
  previous_source: RiskSourceType;
  note: string | null;
}

export interface RiskExplanation {
  current: RiskExplanationCurrent;
  resolution: RiskExplanationResolution;
  override_history: RiskExplanationOverrideRow[];
}
