import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RiskAnalysis, RiskRule, RiskCategory } from '../../database/entities';
import { CreateRiskRuleDto, UpdateRiskStatusDto } from './dto';
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
    @InjectRepository(RiskAnalysis)
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
    return this.riskAnalysisRepository.find({
      where: { id: In(scoped.map((r) => r.id)) },
      relations: ['contract_clause', 'contract_clause.clause', 'handler'],
      order: { created_at: 'DESC' },
    });
  }

  async getByClause(contractClauseId: string): Promise<RiskAnalysis[]> {
    return this.riskAnalysisRepository.find({
      where: { contract_clause_id: contractClauseId },
      relations: ['handler'],
      order: { created_at: 'DESC' },
    });
  }

  async updateRiskStatus(
    id: string,
    dto: UpdateRiskStatusDto,
    userId: string,
  ): Promise<RiskAnalysis> {
    const risk = await this.riskAnalysisRepository.findOne({
      where: { id },
    });

    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }

    risk.status = dto.status;
    risk.handled_by = userId;
    risk.handled_at = new Date();

    const saved = await this.riskAnalysisRepository.save(risk);

    // Emit real-time event
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
    const risks = await this.riskScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );

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
