import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ComplianceCheck,
  ComplianceExtractionStatus,
  ComplianceFinding,
  ComplianceFindingLayer,
  ComplianceFindingSeverity,
  ComplianceFindingStatus,
  ComplianceFindingType,
  ComplianceOverallStatus,
  ContractClause,
  KnowledgeAssetUsage,
  Project,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { MeteringService } from '../../metering/services/metering.service';
import { MeterKey, MeterLedgerStatus } from '../../metering/enums/meter-key.enum';
import { ComplianceKnowledgeService } from './compliance-knowledge.service';
import { ComplianceObligationService } from './compliance-obligation.service';
// Option B — chokepoint migration (compliance finale, 4 of 4): contract-scoped
// reads route through the data-layer tenancy chokepoint (layer 2) UNDER the
// existing controller findInOrg walls (layer 1) — two checks, two layers.
//   - ContractScopedRepository.scopedFindByIdWithRelations → the runCheck
//     jurisdiction load (parent Contract + project, silent-null base; throws
//     here only via the caller's own NotFound, preserving prior behaviour).
//   - ComplianceCheckScopedRepository → listForContract (LIST) + getDetail (by-id).
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';
import { ComplianceCheckScopedRepository } from '../../scoped-repository/compliance-check-scoped.repository';

interface RunCheckOpts {
  contractId: string;
  userId: string;
  orgId: string | null;
  /**
   * Phase 7.18 Part 2 — managing-user JWT account_type.
   *
   * Passed through to `MeteringResolver.resolveMeteringSubject` so the
   * engine's defense-in-depth JWT-org cross-check fires only for
   * managing-user callers (per Invariant 1). Guest / viewer paths would
   * skip the cross-check; this consumer is managing-only today.
   */
  accountType: 'MANAGING' | 'GUEST' | 'FREE' | 'VIEWER';
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
    @InjectRepository(ComplianceCheck) // lint-exempt: write path (create/save) + metering-reconcile & pre-wall by-id reads (see re-labelled call sites); request-scoped READS route through checkScoped
    private readonly checkRepo: Repository<ComplianceCheck>,
    @InjectRepository(ComplianceFinding) // lint-exempt: write path (insert) + two-step findings read (parent check scope-validated upstream); see re-labelled call sites
    private readonly findingRepo: Repository<ComplianceFinding>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ContractClause) // lint-exempt: aggregation QB (Q3 — clause list); called from runCheck (org-scoped jurisdiction load above) + startObligationExtraction (async reconcile, no request org)
    private readonly contractClauseRepo: Repository<ContractClause>,
    // Option B chokepoint (compliance finale) — layer 2 under the controller wall.
    private readonly contractScoped: ContractScopedRepository,
    private readonly checkScoped: ComplianceCheckScopedRepository,
    // Phase 7.24b — write backlink rows (best-effort, never blocks the check).
    @InjectRepository(KnowledgeAssetUsage)
    private readonly usageRepo: Repository<KnowledgeAssetUsage>,
    private readonly aiService: AiService,
    private readonly knowledge: ComplianceKnowledgeService,
    private readonly obligationsLayer: ComplianceObligationService,
    /**
     * Phase 7.18 Part 2 — metering engine (sealed; commit 9200f38 on main).
     * The compliance run is the first consumer to call reserve / commit /
     * release. Engine code MUST NOT be modified — call only.
     */
    private readonly metering: MeteringService,
  ) {}

  /**
   * Kicks off a new compliance check. Returns the row immediately.
   *
   * Phase 7.18 Part 2 — METERED. One user run = ONE reserve at the top of
   * this method. The flow:
   *
   *   1. Access wall has ALREADY run in the controller (PR #45). We trust
   *      `opts.contractId` because the wall authorized it.
   *   2. reserve() inside the runCheck body, BEFORE the check row is
   *      persisted. Capacity-failure throws MeterLimitExceededError
   *      (METER_LIMIT_COMPLIANCE {limit, current}) → 403 to the caller,
   *      no check row, no dispatch.
   *   3. Persist the check row with reservation_id set so the lazy poll-
   *      driven reconcile in refreshFromAi can find it.
   *   4. Dispatch the AI agent. If dispatch throws OR clauses are empty
   *      — both SYNCHRONOUS fail paths — release the reservation in-
   *      request before re-throwing.
   *   5. Terminal SUCCESS / async FAILURE land in refreshFromAi → commit
   *      or release. Never-polled runs rely on the engine's sweeper after
   *      TTL (fail-safe: over-deny, never oversell).
   *
   * The internal startObligationExtraction call is an AUDIT POINT, NOT a
   * second reserve — it rides inside this intent. When obligations
   * becomes its own meter dimension later, that's the bypass point that
   * needs its own gate.
   */
  async runCheck(opts: RunCheckOpts): Promise<ComplianceCheck> {
    // Layer 2 (Option B chokepoint): the parent Contract + its project hydrate
    // through the data-layer org gate (scopedFindByIdWithRelations). The
    // controller wall (assertContractInCallerOrg → findInOrg) already authorised
    // this contractId for opts.orgId (layer 1); this re-gate is the persona-blind
    // second layer. A no-org caller cannot own a contract → 404 (matches the
    // controller's no-org branch and the prior 'Contract not found' shape).
    if (!opts.orgId) throw new NotFoundException('Contract not found');
    const contract = await this.contractScoped.scopedFindByIdWithRelations(
      opts.contractId,
      opts.orgId,
      ['project'],
    );
    if (!contract) throw new NotFoundException('Contract not found');

    // ─────────────────────────────────────────────────────────────────────
    // METERING — reserve. Sits DOWNSTREAM of the access wall (which has
    // already authorized this contract_id for this user's org). Throws
    // MeterLimitExceededError on capacity exhaustion; throws something
    // 5xx-class on a meter SYSTEM error (fail closed per fail_mode).
    //
    // Fresh UUID per run: compliance is intentionally non-idempotent
    // across distinct user runs. The key only dedupes an in-flight retry
    // of the same reserve. Client-supplied Idempotency-Key headers are
    // a deferred future item (audit §9.2).
    // ─────────────────────────────────────────────────────────────────────
    const reservation = await this.metering.reserve({
      caller: {
        user_id: opts.userId,
        jwt_organization_id: opts.orgId,
        account_type: opts.accountType,
      },
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: contract.id,
      actorRef: opts.userId,
      metadata: { route: 'POST /contracts/:contractId/compliance-checks' },
    });

    // From this point on, any throw before the AI dispatch completes
    // MUST release the reservation. We wrap the remainder in a try and
    // release on catch, then re-throw.
    let saved: ComplianceCheck | null = null;
    try {
      const project = contract.project;
      const jurisdiction = this.normalizeJurisdiction(
        project?.country ?? null,
      );

      // Build knowledge context — Phase 7.24e: pass project_id so project-
      // scoped assets are visible to the AI compliance analysis.
      const ctx = await this.knowledge.buildContext({
        orgId: opts.orgId,
        jurisdiction,
        contractType: contract.contract_type,
        projectId: contract.project_id ?? null,
      });

      // Persist the check row first — carrying reservation_id so the lazy
      // poll-driven reconcile can find it.
      const check = this.checkRepo.create({
        contract_id: contract.id,
        project_id: contract.project_id,
        jurisdiction,
        contract_type: contract.contract_type,
        overall_status: ComplianceOverallStatus.PENDING,
        knowledge_assets_used: ctx.asset_ids,
        obligation_extraction_status: ComplianceExtractionStatus.PENDING,
        created_by: opts.userId,
        reservation_id: reservation.reservation_id,
      });
      saved = await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only

      // Phase 7.24b — best-effort backlink write (fire-and-forget with
      // catch at caller level, per lesson #114). Never blocks the check.
      if (ctx.asset_ids.length > 0) {
        const usageRows = ctx.asset_ids.map((assetId) => ({
          asset_id: assetId,
          context_type: 'COMPLIANCE_CHECK',
          context_id: saved!.id,
        }));
        this.usageRepo.insert(usageRows).catch((err: Error) =>
          this.logger.warn(
            `[KB backlinks] Failed to write ${usageRows.length} usage rows for check ${saved!.id}: ${err.message}`,
          ),
        );
      }

      // Load contract clauses.
      const clauses = await this.loadClauses(contract.id);
      if (clauses.length === 0) {
        // Synchronous fail path #1 — no clauses to analyse.
        saved.overall_status = ComplianceOverallStatus.FAILED;
        await this.checkRepo.save(saved); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
        throw new BadRequestException(
          'Contract has no clauses to analyse — extract clauses before running compliance check',
        );
      }

      // Dispatch the AI job.
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
        await this.checkRepo.save(saved); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
      } catch (err) {
        // Synchronous fail path #2 — dispatch threw.
        this.logger.error(
          `Failed to dispatch compliance AI job: ${(err as Error).message}`,
        );
        saved.overall_status = ComplianceOverallStatus.FAILED;
        await this.checkRepo.save(saved); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
        throw err;
      }

      return saved;
    } catch (err) {
      // Release the reservation on ANY synchronous failure after reserve
      // (covers the two named fail paths above plus any unexpected throw
      // in the dispatch chain — defense in depth).
      try {
        const result = await this.metering.release(reservation.reservation_id);
        if (!result.applied) {
          // Engine reported {applied:false} — peer (sweeper, double-release)
          // got there first. Log it explicitly; do NOT swallow.
          this.logger.warn(
            `[metering] release after synchronous compliance failure was a no-op ` +
              `(reservation=${reservation.reservation_id}, status=${result.status}) — ` +
              `metering.compliance.released_after_terminal`,
          );
        }
      } catch (releaseErr) {
        // Releasing failed — log loudly; the original error still rules.
        this.logger.error(
          `[metering] release threw during synchronous failure path ` +
            `(reservation=${reservation.reservation_id}): ${(releaseErr as Error).message}`,
        );
      }
      throw err;
    }
  }

  /**
   * Refresh a check by polling the AI backend. Returns the updated row.
   * If the AI call has completed, persists findings and triggers
   * obligation extraction.
   */
  async refreshFromAi(checkId: string): Promise<ComplianceCheck> {
    const check = await this.checkRepo.findOne({ where: { id: checkId } }); // lint-exempt: metering-reconcile path (async poll, no request org in scope); checkId wall-validated upstream in getOne (getContractIdForCheck → findInOrg)
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
        // Phase 7.18 Part 2 — TERMINAL SUCCESS. Commit the reservation
        // INSIDE the same lazy poll cycle. Inspect TransitionResult and
        // emit an observable warn on {applied:false} so the swept-then-
        // committed case (TTL < end-to-end duration) is loud.
        await this.commitReservationOnSuccess(check);
        // Now kick off obligation extraction — AUDIT POINT, NOT a second
        // reserve. Rides inside this intent. When obligations becomes
        // its own meter dimension, this is the §2.3 bypass point.
        await this.startObligationExtraction(check);
      } else if (job.status === 'failed') {
        check.overall_status = ComplianceOverallStatus.FAILED;
        await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
        // Phase 7.18 Part 2 — TERMINAL FAILURE from the AI side.
        await this.releaseReservationOnFailure(check);
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
        await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
      } else if (job.status === 'failed') {
        check.obligation_extraction_status = ComplianceExtractionStatus.FAILED;
        await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
      }
    }

    return (
      (await this.checkRepo.findOne({ where: { id: check.id } })) ?? check // lint-exempt: metering-reconcile path (async poll re-read of the just-loaded check); checkId wall-validated upstream in getOne
    );
  }

  /**
   * List a contract's compliance checks (newest 50). The controller walls the
   * `:contractId` (layer 1); this routes through the ComplianceCheck scoped
   * chokepoint (layer 2) — the canonical `check → contract → project → org`
   * gate independently bounds the rows to `orgId`. `getManyAndCount` is reused
   * for its `take` support (the org-gated count is discarded; the prior `find`
   * had no count). The wall guarantees `orgId` is non-null here.
   */
  async listForContract(
    contractId: string,
    orgId: string,
  ): Promise<ComplianceCheck[]> {
    const [rows] = await this.checkScoped.scopedFindAndCount(
      { contract_id: contractId },
      orgId,
      { order: { created_at: 'DESC' }, take: 50 },
    );
    return rows;
  }

  /**
   * Resolve a ComplianceCheck's `contract_id` from its `id`. Used by the
   * controller-level access wall on `:checkId` routes — the URL's
   * `:contractId` param is convention; the TRUTH is `check.contract_id`,
   * and the wall must walk that to call `ContractAccessService.findInOrg`.
   *
   * Throws `NotFoundException` if the check doesn't exist (same shape as
   * `ContractAccessService.findInOrg` so a cross-tenant probe sees a
   * uniform 404 either way — no existence leak between "check absent" and
   * "check exists in another org".
   */
  async getContractIdForCheck(checkId: string): Promise<string> {
    const row = await this.checkRepo.findOne({ // lint-exempt: pre-wall resolver — resolves contract_id for the controller's findInOrg wall (cannot itself route through a chokepoint that needs the org it is about to resolve)
      where: { id: checkId },
      select: ['id', 'contract_id'],
    });
    if (!row) throw new NotFoundException('Compliance check not found');
    return row.contract_id;
  }

  async getDetail(
    checkId: string,
    orgId: string,
  ): Promise<ComplianceCheck & { findings: ComplianceFinding[] }> {
    // Layer 2 (Option B chokepoint): the by-id check load routes through the
    // canonical `check → contract → project → org` gate (no-existence-leak 404,
    // matching the prior 'Compliance check not found'). The controller's
    // getOne already walled the check's TRUE contract_id (layer 1); the wall
    // guarantees `orgId` is non-null here.
    const check = await this.checkScoped.scopedFindByIdOrThrow(checkId, orgId);
    const findings = await this.findingRepo.find({ // lint-exempt: two-step — findings keyed by the check id just scope-validated on the line above (no grandchild scoped subclass, same posture as the obligation reminder-log list)
      where: { compliance_check_id: checkId },
      order: { severity: 'ASC', layer: 'ASC' },
    });
    return Object.assign(check, { findings });
  }

  // ─── Metering reconcile helpers (Phase 7.18 Part 2) ──────────────────
  //
  // Both helpers are no-ops when the check carries no `reservation_id` —
  // either it's a pre-metering row (legacy) or the reserve never ran
  // (cannot happen on the wired path, but defense-in-depth).
  //
  // Both inspect TransitionResult and emit OBSERVABLE log signals on
  // {applied:false} per locked context. The signals are named so an Ops
  // search by `metering.compliance.*` finds every applied:false occurrence
  // across the lifecycle.

  /**
   * Called from refreshFromAi's SUCCESS branch after persistFindings.
   *
   * Success commit doesn't change `consumed` (capacity was taken at
   * reserve). The only state change is the ledger row flipping
   * reserved → committed.
   *
   * {applied:false} on success means the reservation was already
   * released, almost always by the sweeper because the run outlived
   * RESERVATION_TTL_SECONDS (the swept-then-uncharged hazard). The run
   * SUCCEEDED but was NOT charged. Emit `metering.compliance.committed_after_release`
   * so Ops can see TTL < end-to-end duration on representative load.
   */
  private async commitReservationOnSuccess(
    check: ComplianceCheck,
  ): Promise<void> {
    if (!check.reservation_id) return;
    try {
      const result = await this.metering.commit(check.reservation_id);
      if (!result.applied) {
        this.logger.warn(
          `[metering] commit on terminal success was a no-op ` +
            `(check=${check.id}, reservation=${check.reservation_id}, ` +
            `status=${result.status}) — run succeeded but is recorded as ` +
            `${result.status}; capacity was reclaimed (sweeper or peer release). ` +
            `metering.compliance.committed_after_release`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] commit threw on terminal success ` +
          `(check=${check.id}, reservation=${check.reservation_id}): ` +
          `${(err as Error).message}. metering.compliance.commit_error`,
      );
    }
  }

  /**
   * Called from refreshFromAi's FAILURE branch (AI job reported failed).
   *
   * Failure release flips the ledger row reserved → released AND refunds
   * `consumed`. {applied:false} means a peer (sweeper, second-failure
   * poll) already released first — log explicitly; don't swallow.
   */
  private async releaseReservationOnFailure(
    check: ComplianceCheck,
  ): Promise<void> {
    if (!check.reservation_id) return;
    try {
      const result = await this.metering.release(check.reservation_id);
      if (!result.applied) {
        this.logger.warn(
          `[metering] release on terminal failure was a no-op ` +
            `(check=${check.id}, reservation=${check.reservation_id}, ` +
            `status=${result.status}) — peer (sweeper / double-poll) won the race. ` +
            `metering.compliance.released_after_terminal`,
        );
      } else if (result.status !== MeterLedgerStatus.RELEASED) {
        // Defensive — should be unreachable since release() only ever
        // sets RELEASED. If we see anything else, surface it loudly.
        this.logger.error(
          `[metering] release returned applied:true but unexpected status ` +
            `(check=${check.id}, reservation=${check.reservation_id}, ` +
            `status=${result.status}). metering.compliance.release_unexpected_status`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] release threw on terminal failure ` +
          `(check=${check.id}, reservation=${check.reservation_id}): ` +
          `${(err as Error).message}. metering.compliance.release_error`,
      );
    }
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
      await this.findingRepo.insert(rows as any); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
    }
    check.findings_summary = aiResult.summary ?? this.summarize(rows);
    check.overall_status = this.coerceEnum(
      aiResult.summary?.overall_status,
      ComplianceOverallStatus,
      this.deriveOverall(rows),
    );
    await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
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
      await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
    } catch (err) {
      this.logger.error(
        `Failed to dispatch obligation extraction: ${(err as Error).message}`,
      );
      check.obligation_extraction_status = ComplianceExtractionStatus.FAILED;
      await this.checkRepo.save(check); // lint-exempt: write (persist check/finding state); the chokepoint is read-only
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
    const ccs = await this.contractClauseRepo // lint-exempt: aggregation QB (Q3 — clause list with leftJoinAndSelect); called from runCheck (org-scoped jurisdiction load above) + startObligationExtraction (async reconcile, no request org)
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
