import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Project,
  Contract,
  Clause,
  ClauseSource,
  ClauseReviewStatus,
  ContractClause,
  RiskAnalysis,
  RiskLevel,
  Obligation,
  ObligationStatus,
  DocumentUpload,
  DocumentProcessingStatus,
} from '../../database/entities';

@Injectable()
export class DashboardAnalyticsService {
  private readonly logger = new Logger(DashboardAnalyticsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(Clause)
    private readonly clauseRepository: Repository<Clause>,
    @InjectRepository(ContractClause)
    private readonly contractClauseRepository: Repository<ContractClause>,
    @InjectRepository(RiskAnalysis)
    private readonly riskAnalysisRepository: Repository<RiskAnalysis>,
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
    @InjectRepository(DocumentUpload)
    private readonly documentUploadRepository: Repository<DocumentUpload>,
  ) {}

  /**
   * Get comprehensive dashboard analytics for the organization.
   * Supports loss-aversion metrics and habit-forming insights.
   */
  async getDashboardAnalytics(orgId: string) {
    const safeQuery = async <T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        this.logger.warn(`Dashboard query "${label}" failed for org ${orgId}: ${err.message}`);
        return fallback;
      }
    };

    const defaultRiskStats = { total: 0, by_level: { HIGH: 0, MEDIUM: 0, LOW: 0 }, by_status: {}, high_unresolved: 0 };
    const defaultObligationStats = { total: 0, overdue: 0, due_this_week: 0, due_this_month: 0, completed: 0, pending: 0, by_status: {}, completion_rate: 0 };
    const defaultClauseStats = { total: 0, ai_extracted: 0, manually_created: 0, pending_review: 0, approved: 0 };
    const defaultDocumentStats = { total: 0, processed: 0, total_pages: 0 };

    const [
      projectStats,
      contractStats,
      riskStats,
      obligationStats,
      clauseStats,
      documentStats,
      recentActivity,
      upcomingObligations,
    ] = await Promise.all([
      safeQuery(() => this.getProjectStats(orgId), { total: 0 }, 'projectStats'),
      safeQuery(() => this.getContractStats(orgId), { total: 0, by_status: {} }, 'contractStats'),
      safeQuery(() => this.getRiskStats(orgId), defaultRiskStats, 'riskStats'),
      safeQuery(() => this.getObligationStats(orgId), defaultObligationStats, 'obligationStats'),
      safeQuery(() => this.getClauseStats(orgId), defaultClauseStats, 'clauseStats'),
      safeQuery(() => this.getDocumentStats(orgId), defaultDocumentStats, 'documentStats'),
      safeQuery(() => this.getRecentActivity(orgId), { recent_documents: [], recent_risks: [] }, 'recentActivity'),
      safeQuery(() => this.getUpcomingObligations(orgId), [], 'upcomingObligations'),
    ]);

    // Calculate derived loss-aversion metrics
    const lossAversion = this.calculateLossAversionMetrics(
      riskStats,
      obligationStats,
      clauseStats,
      documentStats,
    );

    return {
      projects: projectStats,
      contracts: contractStats,
      risks: riskStats,
      obligations: obligationStats,
      clauses: clauseStats,
      documents: documentStats,
      loss_aversion: lossAversion,
      recent_activity: recentActivity,
      upcoming_obligations: upcomingObligations,
    };
  }

  private async getProjectStats(orgId: string) {
    const total = await this.projectRepository.count({
      where: { organization_id: orgId },
    });

    return { total };
  }

  private async getContractStats(orgId: string) {
    const contracts = await this.contractRepository
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .groupBy('c.status')
      .getRawMany();

    const total = contracts.reduce((sum: number, c: { count: string }) => sum + parseInt(c.count, 10), 0);
    const by_status: Record<string, number> = {};
    contracts.forEach((c: { status: string; count: string }) => {
      by_status[c.status] = parseInt(c.count, 10);
    });

    return { total, by_status };
  }

  private async getRiskStats(orgId: string) {
    const risks = await this.riskAnalysisRepository
      .createQueryBuilder('r')
      .select('r.risk_level', 'risk_level')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .groupBy('r.risk_level')
      .addGroupBy('r.status')
      .getRawMany();

    let total = 0;
    const by_level: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const by_status: Record<string, number> = {};
    let high_unresolved = 0;

    risks.forEach((r: { risk_level: string; status: string; count: string }) => {
      const count = parseInt(r.count, 10);
      total += count;
      by_level[r.risk_level] = (by_level[r.risk_level] || 0) + count;
      by_status[r.status] = (by_status[r.status] || 0) + count;
      if (r.risk_level === 'HIGH' && r.status === 'OPEN') {
        high_unresolved += count;
      }
    });

    return { total, by_level, by_status, high_unresolved };
  }

  private async getObligationStats(orgId: string) {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const obligations = await this.obligationRepository
      .createQueryBuilder('o')
      .innerJoin('o.contract_clause', 'cc')
      .innerJoin('cc.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .getMany();

    let total = 0;
    let overdue = 0;
    let due_this_week = 0;
    let due_this_month = 0;
    let completed = 0;
    let pending = 0;
    const by_status: Record<string, number> = {};

    obligations.forEach((o) => {
      total++;
      by_status[o.status] = (by_status[o.status] || 0) + 1;

      if (o.status === ObligationStatus.COMPLETED) {
        completed++;
      } else if (o.status === ObligationStatus.OVERDUE || (o.due_date && new Date(o.due_date) < now)) {
        overdue++;
      } else {
        pending++;
        if (o.due_date) {
          const dueDate = new Date(o.due_date);
          if (dueDate <= sevenDaysFromNow) due_this_week++;
          if (dueDate <= thirtyDaysFromNow) due_this_month++;
        }
      }
    });

    return {
      total,
      overdue,
      due_this_week,
      due_this_month,
      completed,
      pending,
      by_status,
      completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  private async getClauseStats(orgId: string) {
    const clauses = await this.clauseRepository
      .createQueryBuilder('clause')
      // Only count clauses that are actually linked to a contract —
      // orphaned clauses (no contract_clauses entry) are excluded.
      .innerJoin('clause.contract_clauses', 'cc')
      .select('clause.source', 'source')
      .addSelect('clause.review_status', 'review_status')
      .addSelect('COUNT(DISTINCT clause.id)', 'count')
      .where('(clause.organization_id = :orgId OR clause.organization_id IS NULL)', { orgId })
      .andWhere('clause.is_active = true')
      .groupBy('clause.source')
      .addGroupBy('clause.review_status')
      .getRawMany();

    let total = 0;
    let ai_extracted = 0;
    let manually_created = 0;
    let pending_review = 0;
    let approved = 0;

    clauses.forEach((c: { source: string; review_status: string; count: string }) => {
      const count = parseInt(c.count, 10);
      total += count;
      if (c.source === ClauseSource.AI_EXTRACTED) ai_extracted += count;
      if (c.source === ClauseSource.MANUAL) manually_created += count;
      if (c.review_status === ClauseReviewStatus.PENDING_REVIEW) pending_review += count;
      if (c.review_status === ClauseReviewStatus.APPROVED || c.review_status === ClauseReviewStatus.EDITED) {
        approved += count;
      }
    });

    return {
      total,
      ai_extracted,
      manually_created,
      pending_review,
      approved,
    };
  }

  private async getDocumentStats(orgId: string) {
    const documents = await this.documentUploadRepository
      .createQueryBuilder('d')
      .select('d.processing_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(d.page_count)', 'total_pages')
      .where('d.organization_id = :orgId', { orgId })
      .groupBy('d.processing_status')
      .getRawMany();

    let total = 0;
    let processed = 0;
    let total_pages = 0;

    documents.forEach((d: { status: string; count: string; total_pages: string }) => {
      const count = parseInt(d.count, 10);
      total += count;
      if (d.status === DocumentProcessingStatus.CLAUSES_EXTRACTED) processed += count;
      total_pages += parseInt(d.total_pages || '0', 10);
    });

    return { total, processed, total_pages };
  }

  private calculateLossAversionMetrics(
    riskStats: { total: number; high_unresolved: number; by_level: Record<string, number> },
    obligationStats: { overdue: number; due_this_week: number; completion_rate: number },
    clauseStats: { ai_extracted: number; total: number; pending_review: number },
    documentStats: { total_pages: number; processed: number },
  ) {
    // Estimated hours saved: ~2 min/page for manual review, AI does it in seconds
    const hours_saved_extraction = Math.round((documentStats.total_pages * 2) / 60);

    // Estimated hours saved from AI clause extraction: ~5 min/clause manually
    const hours_saved_clause_analysis = Math.round((clauseStats.ai_extracted * 5) / 60);

    // Total value delivered
    const total_hours_saved = hours_saved_extraction + hours_saved_clause_analysis;

    // Risk exposure: high risks that haven't been addressed
    const unaddressed_high_risks = riskStats.high_unresolved;

    // Deadline alerts
    const overdue_obligations = obligationStats.overdue;
    const obligations_due_this_week = obligationStats.due_this_week;

    // Clauses needing attention
    const clauses_pending_review = clauseStats.pending_review;

    return {
      // "You saved" metrics — show value gained
      total_hours_saved,
      hours_saved_extraction,
      hours_saved_clause_analysis,
      documents_processed: documentStats.processed,
      clauses_extracted: clauseStats.ai_extracted,

      // "You'd lose" metrics — show risks of not using platform
      unaddressed_high_risks,
      overdue_obligations,
      obligations_due_this_week,
      clauses_pending_review,

      // Score: overall platform utilization
      obligation_completion_rate: obligationStats.completion_rate,
    };
  }

  private async getRecentActivity(orgId: string) {
    // Get the 5 most recently processed documents
    const recentDocs = await this.documentUploadRepository
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.contract', 'c')
      .where('d.organization_id = :orgId', { orgId })
      .orderBy('d.updated_at', 'DESC')
      .limit(5)
      .getMany();

    // Get the 5 most recent risk findings
    const recentRisks = await this.riskAnalysisRepository
      .createQueryBuilder('r')
      .innerJoin('r.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .orderBy('r.created_at', 'DESC')
      .limit(5)
      .select([
        'r.id',
        'r.risk_level',
        'r.risk_category',
        'r.description',
        'r.status',
        'r.created_at',
      ])
      .getMany();

    return {
      recent_documents: recentDocs.map((d) => ({
        id: d.id,
        file_name: d.original_name || d.file_name,
        status: d.processing_status,
        contract_name: d.contract?.name,
        updated_at: d.updated_at,
      })),
      recent_risks: recentRisks.map((r) => ({
        id: r.id,
        risk_level: r.risk_level,
        category: r.risk_category,
        description: r.description,
        status: r.status,
        created_at: r.created_at,
      })),
    };
  }

  private async getUpcomingObligations(orgId: string) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const upcoming = await this.obligationRepository
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.contract_clause', 'cc')
      .innerJoinAndSelect('cc.contract', 'c')
      .innerJoin('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .andWhere('o.status NOT IN (:...statuses)', {
        statuses: [ObligationStatus.COMPLETED],
      })
      .andWhere('o.due_date IS NOT NULL')
      .andWhere('o.due_date <= :deadline', { deadline: thirtyDaysFromNow })
      .orderBy('o.due_date', 'ASC')
      .limit(10)
      .getMany();

    return upcoming.map((o) => ({
      id: o.id,
      description: o.description,
      due_date: o.due_date,
      status: o.status,
      responsible_party: o.responsible_party,
      contract_name: o.contract_clause?.contract?.name,
      is_overdue: o.due_date ? new Date(o.due_date) < now : false,
      days_until_due: o.due_date
        ? Math.ceil((new Date(o.due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    }));
  }
}
