import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Clause,
  ClauseReviewStatus,
  ClauseSource,
  ContractClause,
  RiskAnalysis,
  RiskAnalysisStatus,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Risk-tab rework — STEP 3: AI clause re-phrase (proposed replacement).
 *
 * Flow (all HOST / managing actions, org-scoped via `findInOrg` → 404 on
 * cross-tenant, never 403 / no existence leak):
 *
 *   1. startRephrase  — dispatch the ai-backend `rephrase-clause` job for the
 *      risk's clause (returns a job_id the frontend polls).
 *   2. pollRephrase   — poll the job; on completion create ONE `is_proposed`
 *      ContractClause (source = AI_DRAFTED, source_document_id = NULL) and link
 *      it to the risk via `proposed_contract_clause_id`. Idempotent: a second
 *      poll after completion returns the already-created proposal.
 *   3. applyRephrase  — accept → promote the proposed clause onto the risk's
 *      live clause via the SAME parent-chain model as
 *      ContractsService.applyProposedVersion (original retired is_active=false,
 *      live junction repointed, proposed junction consumed); reject → discard.
 *
 * WHY a focused path instead of literally calling
 * ContractsService.applyProposedVersion: that entry point is DOCUMENT-scoped
 * (it loads the proposed set by `source_document_id = docId`). Attaching the
 * AI rewrite to a real document id would (a) surface that document in the guest
 * "proposed versions" panel (GuestProposedVersionsPanel lists every document
 * whose getProposedClauses is non-empty) and (b) mix the AI rewrite into a
 * guest's document-scoped compare. Keeping `source_document_id = NULL` isolates
 * the AI rewrite completely — at the cost of not reusing the document-scoped
 * entry point, so the parent-chain PROMOTION MODEL is reused here instead. The
 * shipped guest apply path is left byte-untouched (zero regression risk).
 */
@Injectable()
export class RiskRephraseService {
  private readonly logger = new Logger(RiskRephraseService.name);

  constructor(
    @InjectRepository(RiskAnalysis) // lint-exempt: wall-protected (findInOrg) — row validated before write
    private readonly riskRepo: Repository<RiskAnalysis>,
    @InjectRepository(Clause)
    private readonly clauseRepo: Repository<Clause>,
    @InjectRepository(ContractClause) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause has no scoped repo)
    private readonly ccRepo: Repository<ContractClause>,
    private readonly contractAccess: ContractAccessService,
    private readonly aiService: AiService,
  ) {}

  /** Load the risk + its live clause, walled to the caller's org. */
  private async loadWalledRisk(id: string, orgId: string): Promise<RiskAnalysis> {
    const risk = await this.riskRepo.findOne({ // lint-exempt: wall-protected — findInOrg(risk.contract_id) below rejects cross-tenant before any use
      where: { id },
      relations: ['contract_clause', 'contract_clause.clause'],
    });
    if (!risk) {
      throw new NotFoundException('Risk analysis not found');
    }
    // Cross-tenant probe → 404 (never 403) BEFORE any work.
    await this.contractAccess.findInOrg(risk.contract_id, orgId);
    return risk;
  }

  /**
   * STEP 1 — dispatch the AI rewrite job for this risk's clause. The AI is
   * given the original clause text/title + the risk description + the current
   * (possibly human-edited) recommendation as the mitigation to apply.
   */
  async startRephrase(
    id: string,
    orgId: string,
  ): Promise<{ job_id: string; status: string }> {
    const risk = await this.loadWalledRisk(id, orgId);
    const clause = risk.contract_clause?.clause;
    if (!clause) {
      throw new BadRequestException(
        'This risk is not linked to a clause and cannot be re-phrased',
      );
    }
    return this.aiService.triggerClauseRephrase({
      clause_text: clause.content,
      clause_title: clause.title ?? null,
      risk_description: risk.description ?? null,
      recommendation: risk.recommendation ?? null,
    });
  }

  /**
   * STEP 2 — poll the rewrite job. On completion, create the proposed clause
   * (idempotent) and return it alongside the original for the merge preview.
   */
  async pollRephrase(
    id: string,
    jobId: string,
    orgId: string,
  ): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    proposed?: {
      proposed_contract_clause_id: string;
      title: string;
      content: string;
      original_title: string;
      original_content: string;
    };
  }> {
    const risk = await this.loadWalledRisk(id, orgId);
    const original = risk.contract_clause?.clause;
    if (!original) {
      throw new BadRequestException(
        'This risk is not linked to a clause and cannot be re-phrased',
      );
    }

    // Idempotent: proposal already created (e.g. a second poll / page refresh).
    if (risk.proposed_contract_clause_id) {
      const existing = await this.ccRepo.findOne({ // lint-exempt: wall-protected — risk was loaded via loadWalledRisk (findInOrg) above
        where: { id: risk.proposed_contract_clause_id },
        relations: ['clause'],
      });
      if (existing?.clause) {
        return {
          status: 'completed',
          proposed: {
            proposed_contract_clause_id: existing.id,
            title: existing.clause.title,
            content: existing.clause.content,
            original_title: original.title,
            original_content: original.content,
          },
        };
      }
    }

    const job = await this.aiService.getJobStatus(jobId);
    const status = job?.status as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | undefined;

    if (status === 'failed') {
      return { status: 'failed', error: String(job?.error ?? 'AI job failed') };
    }
    if (status !== 'completed') {
      return { status: status ?? 'processing' };
    }

    // Completed — unwrap the task payload (nested result.result, see chat/#167).
    const payload = job.result?.result ?? job.result ?? {};
    const rewrittenContent = String(payload.rewritten_content ?? '').trim();
    if (!rewrittenContent) {
      return { status: 'failed', error: 'AI returned an empty rewrite' };
    }
    const rewrittenTitle =
      String(payload.rewritten_title ?? '').trim() || original.title;

    // Create the proposed clause + junction, and link it to the risk.
    const proposedCC = await this.createProposedClause(
      risk,
      original,
      rewrittenTitle,
      rewrittenContent,
      orgId,
    );

    return {
      status: 'completed',
      proposed: {
        proposed_contract_clause_id: proposedCC.id,
        title: rewrittenTitle,
        content: rewrittenContent,
        original_title: original.title,
        original_content: original.content,
      },
    };
  }

  /**
   * Non-guest proposed-clause creation. Mirrors the guest path's `is_proposed`
   * shape but is attributed to the AI rewrite (source = AI_DRAFTED) and carries
   * NO source_document_id (isolation from the guest document-scoped machinery).
   * Runs in one transaction so the clause + junction + risk link commit
   * together.
   */
  private async createProposedClause(
    risk: RiskAnalysis,
    original: Clause,
    title: string,
    content: string,
    orgId: string,
  ): Promise<ContractClause> {
    return this.ccRepo.manager.transaction(async (manager) => {
      const clauseRepo = manager.getRepository(Clause);
      const ccRepo = manager.getRepository(ContractClause); // lint-exempt: wall-protected (loadWalledRisk/findInOrg) txn-bound repo; writes scoped to the walled risk's own contract
      const riskRepo = manager.getRepository(RiskAnalysis); // lint-exempt: wall-protected (loadWalledRisk/findInOrg) txn-bound repo; updates only the walled risk row

      const clause = clauseRepo.create({
        organization_id: orgId,
        title,
        content,
        clause_type: original.clause_type,
        source: ClauseSource.AI_DRAFTED,
        source_document_id: null, // isolation from guest document-scoped reads
        is_active: false, // becomes active only on promotion (Merge & Apply)
        review_status: ClauseReviewStatus.PENDING_REVIEW,
      });
      const savedClause = await clauseRepo.save(clause);

      const cc = ccRepo.create({
        contract_id: risk.contract_id,
        clause_id: savedClause.id,
        section_number: risk.contract_clause?.section_number ?? null,
        order_index: 0, // irrelevant while is_proposed=true (excluded from reads)
        is_proposed: true,
      });
      const savedCC = await ccRepo.save(cc);

      await riskRepo.update(
        { id: risk.id },
        { proposed_contract_clause_id: savedCC.id },
      );
      return savedCC;
    });
  }

  /**
   * STEP 3 — apply (Merge & Apply) or discard (Cancel) the pending rewrite.
   *
   * accept: parent-chain promotion — the proposed clause becomes the new live
   *   version of the risk's clause (parent_clause_id → original, original
   *   retired is_active=false), the live junction is repointed at it, and the
   *   proposed junction is consumed. The risk stays attached to the same live
   *   junction, which now carries the re-phrased clause. Mirrors
   *   ContractsService.applyProposedVersion's replaces branch.
   * reject: discard the proposed clause + junction; the recommendation stays
   *   in place under its clause (the CANCELLED UI state).
   */
  async applyRephrase(
    id: string,
    action: 'accept' | 'reject',
    orgId: string,
    userId: string,
    // TASK 3 — when accepting, also mark the risk handled (design 3a checkbox,
    // checked by default). Uses the existing APPROVED status + handled_by/at —
    // no new status value. Ignored on reject.
    markHandled = false,
  ): Promise<{ applied: boolean; action: 'accept' | 'reject' }> {
    const risk = await this.loadWalledRisk(id, orgId);
    if (!risk.proposed_contract_clause_id) {
      throw new BadRequestException('No pending re-phrase to apply for this risk');
    }
    const originalCC = risk.contract_clause;
    if (!originalCC || !originalCC.clause) {
      throw new BadRequestException('This risk is not linked to a live clause');
    }

    await this.ccRepo.manager.transaction(async (manager) => {
      const clauseRepo = manager.getRepository(Clause);
      const ccRepo = manager.getRepository(ContractClause); // lint-exempt: wall-protected (loadWalledRisk/findInOrg) txn-bound repo; writes scoped to the walled risk's own contract
      const riskRepo = manager.getRepository(RiskAnalysis); // lint-exempt: wall-protected (loadWalledRisk/findInOrg) txn-bound repo; updates only the walled risk row

      const proposedCC = await ccRepo.findOne({
        where: { id: risk.proposed_contract_clause_id as string },
        relations: ['clause'],
      });
      if (!proposedCC || !proposedCC.clause) {
        // Link is stale (proposal already gone) — treat as nothing to apply.
        await riskRepo.update(
          { id: risk.id },
          { proposed_contract_clause_id: null },
        );
        return;
      }

      if (action === 'reject') {
        // Discard the proposed clause + junction (FK SET NULL clears the link,
        // but clear it explicitly too for in-txn clarity).
        await riskRepo.update(
          { id: risk.id },
          { proposed_contract_clause_id: null },
        );
        await ccRepo.delete(proposedCC.id);
        await clauseRepo.delete(proposedCC.clause.id);
        return;
      }

      // accept — parent-chain promotion onto the risk's live clause.
      const original = originalCC.clause;
      const propClause = proposedCC.clause;
      propClause.parent_clause_id = original.id;
      propClause.version = (original.version ?? 1) + 1;
      propClause.is_active = true;
      propClause.review_status = ClauseReviewStatus.APPROVED;
      propClause.reviewed_by = userId;
      propClause.reviewed_at = new Date();
      // GROUPING FIX — a proposed clause is deliberately created with
      // source_document_id = NULL (pre-merge isolation: kept out of the guest
      // "proposed versions" panel). On promotion it MUST inherit the original
      // clause's source_document_id, otherwise the Risk/Clauses tabs (which
      // group + order by the source document) would drop the merged clause and
      // all its risks into the null-source "Document" fallback group. The
      // clause's POSITION (section_number + order_index) lives on the junction
      // row, which we REUSE (originalCC — only its clause_id is repointed
      // below), so position is preserved automatically.
      propClause.source_document_id = original.source_document_id;
      await clauseRepo.save(propClause);

      // Retire the original clause version.
      original.is_active = false;
      await clauseRepo.save(original);

      // Repoint the LIVE junction at the new clause (column UPDATE, not save() —
      // originalCC.clause is the loaded ORIGINAL and save() would revert it).
      await ccRepo.update({ id: originalCC.id }, { clause_id: propClause.id });

      // Consume the proposed junction; clear the risk link and stamp merged_at
      // (FIX 1 — the persistent MERGED state; accept path ONLY). When the
      // "mark handled" checkbox was ticked (TASK 3), also resolve the risk via
      // the existing handled semantics (APPROVED + handled_by/at) — mirrors
      // updateRiskStatus; no new status value invented.
      await riskRepo.update(
        { id: risk.id },
        {
          proposed_contract_clause_id: null,
          merged_at: new Date(),
          ...(markHandled
            ? {
                status: RiskAnalysisStatus.APPROVED,
                handled_by: userId,
                handled_at: new Date(),
              }
            : {}),
        },
      );
      await ccRepo.delete(proposedCC.id);
    });

    return { applied: true, action };
  }

  /**
   * TASK 2 (Option C) — edit the PENDING proposed clause's text in place and
   * PERSIST it, so the edit survives reload and is what gets merged. Edits the
   * `is_proposed` clause's title/content only (never the live clause). Returns
   * the updated proposal alongside the original for the merge preview.
   */
  async editProposal(
    id: string,
    dto: { title?: string; content: string },
    orgId: string,
  ): Promise<{
    proposed_contract_clause_id: string;
    title: string;
    content: string;
    original_title: string;
    original_content: string;
  }> {
    const risk = await this.loadWalledRisk(id, orgId);
    const original = risk.contract_clause?.clause;
    if (!risk.proposed_contract_clause_id || !original) {
      throw new BadRequestException('No pending re-phrase to edit for this risk');
    }
    const proposedCC = await this.ccRepo.findOne({ // lint-exempt: wall-protected — risk loaded via loadWalledRisk (findInOrg) above
      where: { id: risk.proposed_contract_clause_id },
      relations: ['clause'],
    });
    if (!proposedCC?.clause) {
      throw new BadRequestException('The proposed clause no longer exists');
    }
    const content = (dto.content ?? '').trim();
    if (!content) {
      throw new BadRequestException('content is required');
    }
    proposedCC.clause.content = content;
    if (dto.title != null) proposedCC.clause.title = dto.title;
    await this.clauseRepo.save(proposedCC.clause);

    return {
      proposed_contract_clause_id: proposedCC.id,
      title: proposedCC.clause.title,
      content: proposedCC.clause.content,
      original_title: original.title,
      original_content: original.content,
    };
  }
}
