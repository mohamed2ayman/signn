import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskAnalysis, RiskRule, RiskCategory } from '../../database/entities';
import { CreateRiskRuleDto, UpdateRiskStatusDto } from './dto';

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
  ) {}

  // ─── Risk Analyses ────────────────────────────────────────

  async getByContract(contractId: string): Promise<RiskAnalysis[]> {
    return this.riskAnalysisRepository.find({
      where: { contract_id: contractId },
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

    return this.riskAnalysisRepository.save(risk);
  }

  async getRiskSummary(contractId: string): Promise<{
    total: number;
    by_level: Record<string, number>;
    by_status: Record<string, number>;
    by_category: Record<string, number>;
  }> {
    const risks = await this.riskAnalysisRepository.find({
      where: { contract_id: contractId },
    });

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
