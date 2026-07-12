import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskAnalysis, RiskRule, RiskCategory } from '../../database/entities';
import { AnnotateRiskDto, CreateRiskRuleDto, UpdateRiskStatusDto } from './dto';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';
// Tenant-isolation Tier 2 — wall the two contractId-keyed reads
// (getByContract + getRiskSummary) via ContractAccessService.findInOrg.
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Option B — S2d: the two per-contract risk LIST reads load through the
// RiskAnalysis scoped-repository chokepoint (canonical
// risk→contract→project→org), UNDER the findInOrg wall — two checks, two layers.
import { RiskScopedRepository } from '../scoped-repository/risk-scoped.repository';

@Injectable()
export class RiskAnalysisService {
  private readonly logger = new Logger(RiskAnalysisService.name);

  constructor(
    @InjectRepository(RiskAnalysis) // lint-exempt: two-step hydration (ids validated by scoped load)
    private readonly riskAnalysisRepository: Repository<RiskAnalysis>,
    @InjectRepository(RiskRule)
    private readonly riskRuleRepository: Repository<RiskRule>,
    @InjectRepository(RiskCategory)
    private readonly riskCategoryRepository: Repository<RiskCategory>,
    private readonly collaborationGateway: CollaborationGateway,
    // Tenant-isolation Tier 2 — cross-tenant probe → 404 from findInOrg.
    private readonly contractAccess: ContractAccessService,
    // Option B — S2d — data-layer tenancy load for the per-contract risk reads.
    private readonly riskScoped: RiskScopedRepository,
  ) {}

  // ─── Risk Analyses ────────────────────────────────────────

  async getByContract(contractId: string, orgId: string): Promise<RiskAnalysis[]> {
    // WALL (persona — Tier 2 / #60, layer 1): cross-tenant probe → 404 BEFORE
    // any data load. Stays independent of the scoped layer below.
    await this.contractAccess.findInOrg(contractId, orgId);
    // SCOPED LIST (tenancy — Option B S2d, layer 2), STEP 1 of the two-step:
    // the org-safe id set comes from the scoped chokepoint, which independently
    // re-applies the canonical risk→contract→project→org join. Cross-tenant
    // rows are excluded even if the wall above were bypassed.
    const scoped = await this.riskScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );
    if (scoped.length === 0) {
      return [];
    }
    // STEP 2 — hydrate on the tenancy-validated ids ONLY. The nested
    // 'contract_clause.clause' relation exceeds scopedFind's single-level
    // relation support; keying by the validated ids (never raw request input)
    // carries the tenancy proof into the hydrate. Same two-step as
    // ObligationsService.findByContract.
    //
    // ORDERING (Risk-tab rework, STEP 1) — the SHARED source of truth with the
    // Clauses tab (ContractsService.getContractClauses uses the identical
    // expression). A QueryBuilder (not `find`) is required so we can order by
    // the source document's priority, which lives two joins away
    // (risk → contract_clause → clause → source_document). Order:
    //   1) document priority ASC — unset (0) / no-document rows sort LAST
    //   2) document upload order (created_at ASC) — fallback when priority unset
    //   3) clause order_index ASC — clause order WITHIN a document (matches the
    //      Clauses tab exactly; order_index numbers from 0 per document)
    //   4) risk id ASC — stable final tiebreak
    // Defensive: a risk whose contract_clause / clause / source_document is
    // missing (e.g. a future DOCUMENT_CONFLICT risk with contract_clause_id
    // NULL) is preserved via LEFT JOINs and sorts to the very end — never
    // dropped, never a crash.
    return this.riskAnalysisRepository // lint-exempt: two-step hydration (ids validated by scoped load)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.contract_clause', 'cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .leftJoinAndSelect('clause.source_document', 'doc')
      // Risk-tab rework — TASK 4: hydrate the parent (previous) clause so a
      // MERGED risk can show "Updated · v{n}" + "View previous version"
      // (read-only) without a second round-trip.
      .leftJoinAndSelect('clause.parent_clause', 'parentClause')
      .leftJoinAndSelect('r.handler', 'handler')
      // Risk-tab rework — STEP 3: hydrate the pending AI-proposed rewrite (if
      // any) so the frontend can render it under the recommendation on load.
      .leftJoinAndSelect('r.proposed_contract_clause', 'pcc')
      .leftJoinAndSelect('pcc.clause', 'pclause')
      .where('r.id IN (:...ids)', { ids: scoped.map((r) => r.id) })
      // Soft-delete: flagged-duplicate risks are excluded from the Risk tab.
      .andWhere('r.is_deleted = false')
      .orderBy('CASE WHEN doc.document_priority > 0 THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('doc.document_priority', 'ASC')
      .addOrderBy('doc.created_at', 'ASC')
      .addOrderBy('cc.order_index', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getMany();
  }

  async getByClause(
    contractClauseId: string,
    orgId: string,
  ): Promise<RiskAnalysis[]> {
    const risks = await this.riskAnalysisRepository.find({ // lint-exempt: two-step hydration (ids validated by scoped load)
      // Soft-delete: exclude flagged-duplicate risks.
      where: { contract_clause_id: contractClauseId, is_deleted: false },
      relations: ['handler'],
      order: { created_at: 'DESC' },
    });
    // No rows → nothing to leak; short-circuit before consulting the wall
    // (there is no contract_id to resolve from an empty result set).
    if (risks.length === 0) {
      return [];
    }
    // WALL (pre-S2e stop-gap): every row for one contract_clause_id shares the
    // SAME contract_id (a clause belongs to exactly one contract), so the
    // cross-tenant probe on that contract gates the whole result set → 404
    // BEFORE any foreign clause's risks are returned. Same findInOrg pattern
    // as the #65 create() wall; NOT a scoped-repository conversion.
    await this.contractAccess.findInOrg(risks[0].contract_id, orgId);
    return risks;
  }

  async updateRiskStatus(
    id: string,
    dto: UpdateRiskStatusDto,
    userId: string,
    orgId: string,
  ): Promise<RiskAnalysis> {
    const risk = await this.riskAnalysisRepository.findOne({ // lint-exempt: two-step hydration (ids validated by scoped load)
      where: { id },
    });

    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }

    // WALL (pre-S2e stop-gap): the by-id load resolves the row's contract_id;
    // the cross-tenant probe → 404 (never 403) BEFORE the status mutation, so
    // a caller can never flip the status on another org's risk analysis. Same
    // findInOrg pattern as the #65 create() wall; NOT a scoped-repo conversion.
    await this.contractAccess.findInOrg(risk.contract_id, orgId);

    risk.status = dto.status;
    risk.handled_by = userId;
    risk.handled_at = new Date();

    const saved = await this.riskAnalysisRepository.save(risk); // lint-exempt: wall-protected (findInOrg) — row validated before write

    // Emit real-time event
    if (risk.contract_id) {
      this.collaborationGateway.emitRiskUpdated(risk.contract_id, {
        contractId: risk.contract_id,
        risk: saved,
      });
    }

    return saved;
  }

  /**
   * Phase 8.3 — human annotation of a finding's `risk_level` / `risk_category`
   * from the editable Risk Analysis tab. Reuses the exact `findInOrg` wall as
   * `updateRiskStatus` (cross-tenant → 404 BEFORE any write).
   *
   * On the FIRST human edit it snapshots the AI ORIGINAL (level + category)
   * into `original_risk_level` / `original_risk_category` so
   * original-vs-corrected is preserved (the Phase-8.3 training signal).
   *
   * `risk_category` is a free-text column (the AI writes arbitrary values, and
   * the existing free-text/`Uncategorized` values are preserved as-is). The
   * editable-tab dropdown constrains a human's choice to the 17 clause-type
   * labels (`CLAUSE_TYPE_LABELS`, reused so risk labels stay in lock-step with
   * clause_type labels); the server bounds it only by shape (`@MaxLength(100)`)
   * — no taxonomy list is duplicated on the backend.
   *
   * Deliberately edits the label layer ONLY: it never touches
   * likelihood/impact/risk_score and never triggers the drift /
   * learned-baseline machinery (that is the separate B.3 override path).
   */
  async annotateRisk(
    id: string,
    dto: AnnotateRiskDto,
    userId: string,
    orgId: string,
  ): Promise<RiskAnalysis> {
    if (
      dto.risk_level === undefined &&
      dto.risk_category === undefined &&
      dto.recommendation === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one of risk_level, risk_category or recommendation',
      );
    }

    const risk = await this.riskAnalysisRepository.findOne({ // lint-exempt: two-step hydration (ids validated by scoped load)
      where: { id },
    });
    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }

    // WALL (pre-S2e stop-gap): the by-id load resolves the row's contract_id;
    // the cross-tenant probe → 404 (never 403) BEFORE the mutation. Same
    // findInOrg pattern as updateRiskStatus / the #65 create() wall.
    await this.contractAccess.findInOrg(risk.contract_id, orgId);

    // Snapshot the AI ORIGINAL exactly once — immediately before the first
    // human edit. Guarded on is_edited_by_user so subsequent edits keep the
    // TRUE original, not the previous human value.
    if (!risk.is_edited_by_user) {
      risk.original_risk_level = risk.risk_level;
      risk.original_risk_category = risk.risk_category;
      // Snapshot the AI-drafted recommendation too (Risk-tab rework, STEP 2).
      // `?? null` normalises a pre-existing NULL recommendation so the
      // was_corrected signal is unambiguous.
      risk.original_recommendation = risk.recommendation ?? null;
    }

    if (dto.risk_level !== undefined) {
      risk.risk_level = dto.risk_level;
    }
    if (dto.risk_category !== undefined) {
      risk.risk_category = dto.risk_category;
    }
    if (dto.recommendation !== undefined) {
      risk.recommendation = dto.recommendation;
    }
    risk.is_edited_by_user = true;
    risk.edited_by_user_id = userId;
    risk.edited_at = new Date();

    // save() (not update()) so the @BeforeUpdate hook runs — risk_score is
    // recomputed from the UNCHANGED L/I (annotation never edits L/I), so the
    // score is left intact; only the label layer changes.
    const saved = await this.riskAnalysisRepository.save(risk); // lint-exempt: wall-protected (findInOrg) — row validated before write

    if (risk.contract_id) {
      this.collaborationGateway.emitRiskUpdated(risk.contract_id, {
        contractId: risk.contract_id,
        risk: saved,
      });
    }

    return saved;
  }

  async getRiskSummary(contractId: string, orgId: string): Promise<{
    total: number;
    by_level: Record<string, number>;
    by_status: Record<string, number>;
    by_category: Record<string, number>;
  }> {
    // WALL (persona — Tier 2 / #60, layer 1): cross-tenant probe → 404.
    await this.contractAccess.findInOrg(contractId, orgId);
    // SCOPED LIST (tenancy — Option B S2d, layer 2): the per-contract risk rows
    // load through the scoped chokepoint (canonical risk→contract→project→org);
    // the in-memory aggregation below is unchanged.
    const scopedRisks = await this.riskScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );
    // Soft-delete: flagged-duplicate risks never count in the summary.
    const risks = scopedRisks.filter((r) => !r.is_deleted);

    const byLevel: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const risk of risks) {
      byLevel[risk.risk_level] = (byLevel[risk.risk_level] || 0) + 1;
      byStatus[risk.status] = (byStatus[risk.status] || 0) + 1;
      byCategory[risk.risk_category] = (byCategory[risk.risk_category] || 0) + 1;
    }

    return {
      total: risks.length,
      by_level: byLevel,
      by_status: byStatus,
      by_category: byCategory,
    };
  }

  // ─── Risk Rules ────────────────────────────────────────────

  async getRules(activeOnly: boolean = true): Promise<RiskRule[]> {
    const where: any = {};
    if (activeOnly) where.is_active = true;

    return this.riskRuleRepository.find({
      where,
      relations: ['creator'],
      order: { created_at: 'DESC' },
    });
  }

  async createRule(
    dto: CreateRiskRuleDto,
    userId: string,
  ): Promise<RiskRule> {
    const rule = this.riskRuleRepository.create({
      ...dto,
      created_by: userId,
    });

    return this.riskRuleRepository.save(rule);
  }

  async updateRule(
    id: string,
    dto: Partial<CreateRiskRuleDto> & { is_active?: boolean },
  ): Promise<RiskRule> {
    const rule = await this.riskRuleRepository.findOne({ where: { id } });

    if (!rule) {
      throw new NotFoundException('Risk rule not found');
    }

    Object.assign(rule, dto);
    return this.riskRuleRepository.save(rule);
  }

  async deleteRule(id: string): Promise<void> {
    const rule = await this.riskRuleRepository.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Risk rule not found');

    rule.is_active = false;
    await this.riskRuleRepository.save(rule);
  }

  // ─── Risk Categories ──────────────────────────────────────

  async getCategories(): Promise<RiskCategory[]> {
    return this.riskCategoryRepository.find({
      where: { is_active: true },
      order: { name: 'ASC' },
    });
  }
}
