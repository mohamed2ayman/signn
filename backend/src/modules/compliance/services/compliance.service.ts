import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ComplianceCheck,
  ComplianceExtractionStatus,
  ComplianceFinding,
  ComplianceFindingLayer,
  ComplianceFindingSeverity,
  ComplianceFindingStatus,
  ComplianceFindingType,
  ComplianceOverallStatus,
  Contract,
  ContractClause,
  KnowledgeAssetUsage,
  Project,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { ComplianceKnowledgeService } from './compliance-knowledge.service';
import { ComplianceObligationService } from './compliance-obligation.service';

interface RunCheckOpts {
  contractId: string;
  userId: string;
  orgId: string | null;
}

/**
 * Orchestrates the 5-layer compliance pipeline.
 *
 * Layers 1-3 run as one Claude call; layer 4 (obligation extraction) chains
 * to the existing obligations agent; layer 5 (jurisdiction conflict report)
 * is just a filtered view of layer 1+2 findings — no extra AI call.
 *
 * The flow:
 *   1. Create ComplianceCheck row (status=PENDING)
 *   2. Build knowledge context from KAs
 *   3. Dispatch AI compliance-check task → store ai_job_id
 *   4. Background poller (or webhook on completion) writes findings,
 *      updates summary, then dispatches obligation extraction
 *   5. When obligation extraction completes, ComplianceObligationService
 *      bulk-creates Obligation rows tagged with this check
 *
 * For v1, polling is driven by the consumer (frontend polls
 * GET /compliance-checks/:id which calls `refreshFromAi(checkId)`).
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectRepository(ComplianceCheck)
    private readonly checkRepo: Repository<ComplianceCheck>,
    @InjectRepository(ComplianceFinding)
    private readonly findingRepo: Repository<ComplianceFinding>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ContractClause)
    private readonly contractClauseRepo: Repository<ContractClause>,
    // Phase 7.24b — write backlink rows (best-effort, never blocks the check).
    @InjectRepository(KnowledgeAssetUsage)
    private readonly usageRepo: Repository<KnowledgeAssetUsage>,
    private readonly aiService: AiService,
    private readonly knowledge: ComplianceKnowledgeService,
    private readonly obligationsLayer: ComplianceObligationService,
  ) {}

  /** Kicks off a new compliance check. Returns the row immediately. */
  async runCheck(opts: RunCheckOpts): Promise<ComplianceCheck> {
    const contract = await this.contractRepo.findOne({
      where: { id: opts.contractId },
      relations: ['project'],
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const project = contract.project;
    const jurisdiction = this.normalizeJurisdiction(project?.country ?? null);

    // Build knowledge context — Phase 7.24e: pass project_id so project-scoped
    // assets are visible to the AI compliance analysis.
    const ctx = await this.knowledge.buildContext({
      orgId: opts.orgId,
      jurisdiction,
      contractType: contract.contract_type,
      projectId: contract.project_id ?? null,
    });

    // Persist the check row first
    const check = this.checkRepo.create({
      contract_id: contract.id,
      project_id: contract.project_id,
      jurisdiction,
      contract_type: contract.contract_type,
      overall_status: ComplianceOverallStatus.PENDING,
      knowledge_assets_used: ctx.asset_ids,
      obligation_extraction_status: ComplianceExtractionStatus.PENDING,
      created_by: opts.userId,
    });
    const saved = await this.checkRepo.save(check);

    // Phase 7.24b — best-effort backlink write (fire-and-forget with catch at
    // caller level, per lesson #114).  Never blocks the compliance check.
    if (ctx.asset_ids.length > 0) {
      const usageRows = ctx.asset_ids.map((assetId) => ({
        asset_id: assetId,
        context_type: 'COMPLIANCE_CHECK',
        context_id: saved.id,
      }));
      this.usageRepo.insert(usageRows).catch((err: Error) =>
        this.logger.warn(
          `[KB backlinks] Failed to write ${usageRows.length} usage rows for check ${saved.id}: ${err.message}`,
        ),
      );
    }

    // Load contract clauses
    const clauses = await this.loadClauses(contract.id);
    if (clauses.length === 0) {
      saved.overall_status = ComplianceOverallStatus.FAILED;
      await this.checkRepo.save(saved);
      throw new BadRequestException(
        'Contract has no clauses to analyse — extract clauses before running compliance check',
      );
    }

    // Dispatch the AI job
    try {
      const dispatch = await this.aiService.triggerComplianceCheck({
        contract_id: contract.id,
        contract_type: contract.contract_type,
        jurisdiction,
        clauses: clauses.map((c) => ({
          id: c.id,
          text: c.text,
          clause_ref: c.clause_ref,
          document_label: c.document_label,
        })),
        standard_knowledge: ctx.standard_knowledge,
        jurisdiction_knowledge: ctx.jurisdiction_knowledge,
        playbook_knowledge: ctx.playbook_knowledge,
      });
      saved.ai_job_id = dispatch.job_id;
      await this.checkRepo.save(saved);
    } catch (err) {
      this.logger.error(
        `Failed to dispatch compliance AI job: ${(err as Error).message}`,
      );
      saved.overall_status = ComplianceOverallStatus.FAILED;
      await this.checkRepo.save(saved);
      throw err;
    }

    return saved;
  }

  /**
   * Refresh a check by polling the AI backend. Returns the updated row.
   * If the AI call has completed, persists findings and triggers
   * obligation extraction.
   */
  async refreshFromAi(checkId: string): Promise<ComplianceCheck> {
    const check = await this.checkRepo.findOne({ where: { id: checkId } });
    if (!check) throw new NotFoundException('Compliance check not found');

    // If already completed, nothing to do
    if (
      check.overall_status !== ComplianceOverallStatus.PENDING &&
      check.obligation_extraction_status === ComplianceExtractionStatus.COMPLETED
    ) {
      return check;
    }

    // Poll the compliance AI job
    if (
      check.ai_job_id &&
      check.overall_status === ComplianceOverallStatus.PENDING
    ) {
      const job = await this.aiService.getJobStatus(check.ai_job_id);
      if (job.status === 'completed' && job.result?.result) {
        await this.persistFindings(check, job.result.result);
        // Now kick off obligation extraction
        await this.startObligationExtraction(check);
      } else if (job.status === 'failed') {
        check.overall_status = ComplianceOverallStatus.FAILED;
        await this.checkRepo.save(check);
      }
    }

    // Poll the obligation extraction job
    if (
      check.obligation_job_id &&
      check.obligation_extraction_status === ComplianceExtractionStatus.RUNNING
    ) {
      const job = await this.aiService.getJobStatus(check.obligation_job_id);
      if (job.status === 'completed' && job.result?.result?.obligations) {
        await this.obligationsLayer.persistFromExtraction(
          check,
          job.result.result.obligations,
        );
        check.obligation_extraction_status = ComplianceExtractionStatus.COMPLETED;
        await this.checkRepo.save(check);
      } else if (job.status === 'failed') {
        check.obligation_extraction_status = ComplianceExtractionStatus.FAILED;
        await this.checkRepo.save(check);
      }
    }

    return (
      (await this.checkRepo.findOne({ where: { id: check.id } })) ?? check
    );
  }

  async listForContract(contractId: string): Promise<ComplianceCheck[]> {
    return this.checkRepo.find({
      where: { contract_id: contractId },
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  async getDetail(
    checkId: string,
  ): Promise<ComplianceCheck & { findings: ComplianceFinding[] }> {
    const check = await this.checkRepo.findOne({ where: { id: checkId } });
    if (!check) throw new NotFoundException('Compliance check not found');
    const findings = await this.findingRepo.find({
      where: { compliance_check_id: checkId },
      order: { severity: 'ASC', layer: 'ASC' },
    });
    return Object.assign(check, { findings });
  }

  // ─── Internals ────────────────────────────────────────────

  private async persistFindings(
    check: ComplianceCheck,
    aiResult: { findings: any[]; summary?: any },
  ): Promise<void> {
    const rows: Partial<ComplianceFinding>[] = (aiResult.findings ?? []).map(
      (f) => ({
        compliance_check_id: check.id,
        layer: this.coerceEnum(
          f.layer,
          ComplianceFindingLayer,
          ComplianceFindingLayer.STANDARD,
        ),
        clause_ref: f.clause_ref ?? null,
        finding_type: this.coerceEnum(
          f.finding_type,
          ComplianceFindingType,
          ComplianceFindingType.DEVIATION,
        ),
        severity: this.coerceEnum(
          f.severity,
          ComplianceFindingSeverity,
          ComplianceFindingSeverity.MEDIUM,
        ),
        requirement: f.requirement ?? '',
        actual_text: f.actual_text ?? null,
        recommendation: f.recommendation ?? null,
        knowledge_asset_ref: f.knowledge_asset_ref ?? null,
        status: ComplianceFindingStatus.OPEN,
      }),
    );
    if (rows.length > 0) {
      await this.findingRepo.insert(rows as any);
    }
    check.findings_summary = aiResult.summary ?? this.summarize(rows);
    check.overall_status = this.coerceEnum(
      aiResult.summary?.overall_status,
      ComplianceOverallStatus,
      this.deriveOverall(rows),
    );
    await this.checkRepo.save(check);
  }

  private async startObligationExtraction(check: ComplianceCheck): Promise<void> {
    const clauses = await this.loadClauses(check.contract_id);
    try {
      const dispatch = await this.aiService.triggerExtractObligations({
        contract_id: check.contract_id,
        clauses: clauses.map((c) => ({ id: c.id, text: c.text })),
      });
      check.obligation_job_id = dispatch.job_id;
      check.obligation_extraction_status = ComplianceExtractionStatus.RUNNING;
      await this.checkRepo.save(check);
    } catch (err) {
      this.logger.error(
        `Failed to dispatch obligation extraction: ${(err as Error).message}`,
      );
      check.obligation_extraction_status = ComplianceExtractionStatus.FAILED;
      await this.checkRepo.save(check);
    }
  }

  private async loadClauses(contractId: string): Promise<
    Array<{
      id: string;
      text: string;
      clause_ref: string | null;
      document_label: string | null;
    }>
  > {
    const ccs = await this.contractClauseRepo
      .createQueryBuilder('cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .where('cc.contract_id = :contractId', { contractId })
      .orderBy('cc.order_index', 'ASC')
      .getMany();
    return ccs
      .filter((cc) => cc.clause)
      .map((cc) => ({
        id: cc.clause.id,
        text: cc.clause.content ?? cc.clause.title ?? '',
        clause_ref: (cc.clause as any).clause_number ?? null,
        document_label: (cc as any).document_label ?? null,
      }));
  }

  private summarize(findings: Partial<ComplianceFinding>[]): Record<string, any> {
    const byLayer: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const f of findings) {
      if (f.layer) byLayer[f.layer] = (byLayer[f.layer] ?? 0) + 1;
      if (f.severity) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }
    return {
      total: findings.length,
      by_layer: byLayer,
      by_severity: bySeverity,
    };
  }

  private deriveOverall(
    findings: Partial<ComplianceFinding>[],
  ): ComplianceOverallStatus {
    const sev = findings.map((f) => f.severity);
    if (sev.includes(ComplianceFindingSeverity.CRITICAL))
      return ComplianceOverallStatus.NON_COMPLIANT;
    if (sev.includes(ComplianceFindingSeverity.HIGH))
      return ComplianceOverallStatus.PARTIALLY_COMPLIANT;
    return ComplianceOverallStatus.COMPLIANT;
  }

  private coerceEnum<T extends Record<string, string>>(
    raw: unknown,
    enumObj: T,
    fallback: T[keyof T],
  ): T[keyof T] {
    if (typeof raw === 'string') {
      const upper = raw.toUpperCase();
      if (Object.values(enumObj).includes(upper as T[keyof T])) {
        return upper as T[keyof T];
      }
    }
    return fallback;
  }

  private normalizeJurisdiction(country: string | null): string | null {
    if (!country) return null;
    const trimmed = country.trim();
    if (trimmed.length === 2) return trimmed.toUpperCase();
    // Lookup table for common verbose values
    const map: Record<string, string> = {
      EGYPT: 'EG',
      'EGYPT (EG)': 'EG',
      UAE: 'AE',
      'UNITED ARAB EMIRATES': 'AE',
      'SAUDI ARABIA': 'SA',
      'UNITED KINGDOM': 'GB',
      UK: 'GB',
      INTERNATIONAL: 'INTL',
    };
    return map[trimmed.toUpperCase()] ?? trimmed.toUpperCase().slice(0, 10);
  }
}
