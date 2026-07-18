import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  AccountType,
  AuditLog,
  DocumentUpload,
  DocumentProcessingStatus,
  Clause,
  ClauseSource,
  ClauseReviewStatus,
  ContractClause,
  Contract,
  RiskAnalysis,
  RiskCategory,
  RiskLevel,
  User,
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AiService } from '../ai/ai.service';
import { RiskMethodologyResolverService } from '../risk-analysis/services/risk-methodology-resolver.service';
import { RiskSourceType } from '../risk-analysis/enums/risk-source-type.enum';
import {
  mapScoreToRiskLevel,
  mapSeverityToLikelihoodImpact,
} from '../risk-analysis/utils/severity-mapping';
import { computeCoverTrim, computePreambleWindow } from './utils/cover-trim.util';
import { resolveParties, type ExtractedParties } from './utils/parties-extract.util';
// Tenant-isolation Tier 1 — service-level wall on uploadAndProcess +
// reprocess + finalizeReview. Same `findInOrg` shape as PR #45.
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Signed-state pinning (Slice 2) — a pinned contract's legal content is
// frozen: upload/reprocess/extracted-text/review writers reject with 409
// CONTRACT_PINNED; the SYSTEM extraction driver terminalizes instead of
// writing clauses.
import {
  assertClauseMutable,
  assertContractMutable,
  isContractPinned,
} from '../contracts/utils/contract-pin-guard.util';
// Phase 7.18 Part 3 — second metered consumer. MeteringService is the
// engine authority; reserve sits DOWNSTREAM of the Tier 1 wall, before
// storage/dispatch. Engine code MUST NOT be modified — call only.
import { MeteringService } from '../metering/services/metering.service';
import { MeterKey, MeterLedgerStatus } from '../metering/enums/meter-key.enum';
import { MeteringCaller } from '../metering/services/metering-resolver.service';
// Option B — S2f: the DocumentUpload data-layer tenancy chokepoint. The two
// clean request-scoped reads (getDocuments + the Phase-1-walled
// updateExtractedText) load THROUGH this scoped repo, UNDER the findInOrg wall
// (two checks, two layers). Required constructor dependency — same house style
// as every other scoped repo (S2c-2/S2d/S2e). Provided via ScopedRepositoryModule.
import { DocumentUploadScopedRepository } from '../scoped-repository/document-upload-scoped.repository';

/**
 * Issue 5 — minimal category alias bridge. The risk_analyzer prompt tells the
 * AI to use names like "Payment Terms" / "Force Majeure", but the
 * `risk_categories` taxonomy rows are worded differently and suffixed
 * "... Risks" ("Cost and Payment Risks", "Force Majeure Risks", …). An exact
 * name match therefore NEVER succeeded and downgraded every category to
 * "Uncategorized". This map bridges the AI's category vocabulary onto the 8
 * taxonomy rows; unmapped values still fall through to "Uncategorized" (audited).
 * Keys are normalized (lower-cased, whitespace-collapsed). A full vocabulary
 * redesign (align the prompt, taxonomy, and the frontend's 17 clause-type
 * labels to ONE set) is a tracked backlog decision.
 */
const RISK_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  'payment terms': 'Cost and Payment Risks',
  payment: 'Cost and Payment Risks',
  'cost overrun': 'Cost and Payment Risks',
  'force majeure': 'Force Majeure Risks',
  'dispute resolution': 'Dispute Resolution Risks',
  arbitration: 'Dispute Resolution Risks',
  termination: 'Contractual and Legal Risks',
  'liability cap': 'Contractual and Legal Risks',
  liability: 'Contractual and Legal Risks',
  indemnification: 'Contractual and Legal Risks',
  indemnity: 'Contractual and Legal Risks',
  confidentiality: 'Contractual and Legal Risks',
  'intellectual property': 'Contractual and Legal Risks',
  compliance: 'Contractual and Legal Risks',
  contractual: 'Contractual and Legal Risks',
  legal: 'Contractual and Legal Risks',
  'contractual/legal': 'Contractual and Legal Risks',
  'notice period': 'Time and Delay Risks',
  delay: 'Time and Delay Risks',
  time: 'Time and Delay Risks',
  'liquidated damages': 'Time and Delay Risks',
  'performance bond': 'Performance and Quality Risks',
  warranty: 'Performance and Quality Risks',
  quality: 'Performance and Quality Risks',
  defects: 'Performance and Quality Risks',
  insurance: 'Performance and Quality Risks',
  'scope of work': 'Design and Scope Risks',
  scope: 'Design and Scope Risks',
  design: 'Design and Scope Risks',
  variations: 'Design and Scope Risks',
  subcontracting: 'Subcontracting Risks',
  subcontract: 'Subcontracting Risks',
};

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    @InjectRepository(DocumentUpload) // lint-exempt: S2f-deferred (metering-entangled, walled)
    private readonly documentUploadRepository: Repository<DocumentUpload>,
    @InjectRepository(Clause)
    private readonly clauseRepository: Repository<Clause>,
    @InjectRepository(ContractClause) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause)
    private readonly contractClauseRepository: Repository<ContractClause>,
    @InjectRepository(Contract) // lint-exempt: S2f-deferred (metering-entangled, walled)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(RiskAnalysis) // lint-exempt: S2f-deferred (metering-entangled, walled)
    private readonly riskAnalysisRepository: Repository<RiskAnalysis>,
    // Phase 7.17 — Prompt 1, A.1: audit-logs AI_RETURNED_UNKNOWN_RISK_CATEGORY
    // events when the AI returns a category that doesn't match the
    // risk_categories taxonomy.
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    // Phase 7.17 — Prompt 1, A.1: writer validates AI-returned categories
    // against the active taxonomy (per plan Decision 9). Unknown values
    // become 'Uncategorized' + audit log.
    @InjectRepository(RiskCategory)
    private readonly riskCategoryRepository: Repository<RiskCategory>,
    private readonly storageService: StorageService,
    private readonly aiService: AiService,
    // Phase 7.17 — Prompt 1, A.1: resolves default L,I per finding via
    // the 4-step priority chain (KB ref → org learned → platform default →
    // fallback). The resolver's 5-min cache makes per-finding calls cheap.
    private readonly riskResolver: RiskMethodologyResolverService,
    // Tenant-isolation Tier 1 — `findInOrg(contractId, orgId)` throws
    // NotFoundException (404) on cross-tenant probe; no existence leak.
    // Same shape as PR #42 / #45.
    private readonly contractAccess: ContractAccessService,
    // Phase 7.18 Part 3 — second metered consumer wiring
    // (`upload_extraction`). reserve / commit / release lifecycle mirrors
    // the proven compliance Part 2 shape verbatim. Engine code MUST NOT
    // be modified — call only.
    private readonly metering: MeteringService,
    // Option B — S2f — data-layer tenancy load for the two clean
    // request-scoped DocumentUpload reads (getDocuments + updateExtractedText).
    // Required dependency (house style); provided via ScopedRepositoryModule.
    private readonly documentScoped: DocumentUploadScopedRepository,
    // Guest extraction completion (Slice 1) — appended LAST to preserve the
    // existing positional constructor order for direct-construction unit tests.
    // Used ONLY to read the uploader's account_type so the extraction-advance
    // core can decide, INTRINSICALLY from the document, whether this is a guest
    // upload (→ proposed clauses, no party-backfill). Deriving it from the doc
    // (not the calling endpoint) closes the race where a host polling a guest's
    // in-progress doc via the managing status route would otherwise write LIVE
    // clauses + backfill.
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Upload a document and start the processing pipeline.
   */
  async uploadAndProcess(
    contractId: string,
    file: UploadedFile,
    userId: string,
    orgId: string,
    options?: {
      document_label?: string;
      document_priority?: number;
      /**
       * Phase 7.18 Part 3 — caller account_type for the metering engine's
       * defense-in-depth JWT cross-check (Invariant 1). The access wall
       * above already proved the contract is in the user's org; this just
       * lets the engine ALSO cross-check. Defaults to MANAGING because
       * this entry point is reachable only via the JWT-guarded
       * `POST /contracts/:contractId/documents` controller route — the
       * guest portal does NOT call this method today (audit STEP 0a /
       * recon: guest upload is a captured-intent stub at
       * guest-invitation.service.ts:445).
       */
      account_type?: MeteringCaller['account_type'];
      /**
       * Feature #4 — which meter to charge. Defaults to UPLOAD_EXTRACTION so
       * the managing-user path (`POST /contracts/:contractId/documents`) is
       * byte-identical to before. The guest upload path passes
       * MeterKey.GUEST_UPLOAD so guest usage is charged to a SEPARATE meter
       * (capped/attributed independently; never consumes the host's managing
       * upload_extraction quota). Subject is still the host org either way —
       * the resolver derives contract → project → organization_id.
       */
      meterKey?: MeterKey;
    },
  ): Promise<DocumentUpload> {
    // Tenant-isolation Tier 1 — replace the bare `findOne({ id: contractId })`
    // with `contractAccess.findInOrg(contractId, orgId)`. Cross-tenant
    // probe → 404 (NOT 403 — no existence leak). In-org behaviour
    // unchanged: contract existence is still verified, the org-mismatch
    // case is the new defense.
    const walledContract = await this.contractAccess.findInOrg(contractId, orgId);

    // Signed-state pinning (Slice 2) — AFTER the wall (404-first), BEFORE the
    // metering reserve (a doomed upload must not charge). A pinned contract's
    // clause set is frozen; new-version extraction is rejected with 409
    // CONTRACT_PINNED. This is the SHARED seam for BOTH the managing route
    // and the guest upload path (guest-upload.service also guards pre-slot).
    await assertContractMutable(
      this.documentUploadRepository.manager,
      walledContract,
    );

    // ─────────────────────────────────────────────────────────────────────
    // Phase 7.18 Part 3 — METERING reserve.
    //
    // Sits DOWNSTREAM of the Tier 1 access wall (which has already
    // authorized this contract_id for this user's org). BEFORE storage
    // upload + Celery dispatch — the work we're metering hasn't happened
    // yet on a capacity-exhausted call.
    //
    // Throws MeterLimitExceededError on capacity exhaustion → 403
    // METER_LIMIT_UPLOAD_EXTRACTION envelope (no doc row, no storage
    // write, no dispatch). Throws something 5xx-class on a meter SYSTEM
    // error (fail closed per meter_definition.fail_mode='closed').
    //
    // Fresh UUID per upload: managing-user upload is intentionally
    // non-idempotent across distinct user runs — the engine's
    // idempotency_key only dedupes an in-flight retry of the SAME
    // reserve. Client-supplied Idempotency-Key header convention is the
    // deferred audit §9.2 future item.
    // ─────────────────────────────────────────────────────────────────────
    const reservation = await this.metering.reserve({
      caller: {
        user_id: userId,
        jwt_organization_id: orgId,
        account_type: options?.account_type ?? 'MANAGING',
      },
      meterKey: options?.meterKey ?? MeterKey.UPLOAD_EXTRACTION,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: userId,
      metadata: {
        route:
          options?.meterKey === MeterKey.GUEST_UPLOAD
            ? 'POST /guest/contracts/:id/documents'
            : 'POST /contracts/:contractId/documents',
      },
    });

    // From this point on, any throw BEFORE the doc row is persisted with
    // reservation_id set MUST release the reservation in-request — the
    // local `reservation` handle is the only carrier. After the doc row
    // is saved, the row IS the carrier and the lazy poll-driven
    // reconcile in pollAndAdvance owns terminal commit/release.
    let saved: DocumentUpload;
    try {
      // Upload file to storage
      const uploadResult = await this.storageService.uploadFile(file, 'contracts');

      // Multer delivers originalname as Latin-1 encoded bytes.
      // Decode to UTF-8 so non-ASCII characters (e.g. Arabic) display correctly.
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf-8');

      // Create document record — carrying reservation_id so the lazy
      // poll-driven reconcile in pollAndAdvance can find it.
      const doc = this.documentUploadRepository.create({
        contract_id: contractId,
        organization_id: orgId,
        file_url: uploadResult.file_url,
        file_name: uploadResult.file_name,
        original_name: decodedName,
        file_size: file.size,
        mime_type: file.mimetype,
        document_label: options?.document_label || null,
        document_priority: options?.document_priority ?? 0,
        processing_status: DocumentProcessingStatus.UPLOADED,
        uploaded_by: userId,
        reservation_id: reservation.reservation_id,
      });

      saved = await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
      this.logger.log(
        `Document uploaded: ${saved.id} for contract ${contractId} ` +
          `(reservation=${reservation.reservation_id})`,
      );
    } catch (err) {
      // Sync failure between reserve() and the doc-row save. The local
      // `reservation` handle is the only carrier of reservation_id; release
      // in-request before re-throwing.
      await this.releaseReservationInFlight(
        reservation.reservation_id,
        err as Error,
      );
      throw err;
    }

    // Start text extraction. The helper handles its own sync-dispatch
    // failure internally (sets FAILED + calls releaseReservationOnFailure).
    // pollAndAdvance owns the async terminal SUCCESS / async terminal
    // FAILURE commit/release.
    await this.startTextExtraction(saved);

    return saved;
  }

  /**
   * Trigger text extraction for a document.
   *
   * Phase 7.18 Part 3 — first SYNC-DISPATCH terminal failure path. The
   * catch block sets status=FAILED and swallows the error (so callers
   * like uploadAndProcess + reprocess still return cleanly). Because
   * FAILED here is a TERMINAL state — pollAndAdvance's terminal-status
   * guard at the top short-circuits on it — this is also where we
   * release the metering reservation. No race with pollAndAdvance
   * because pollAndAdvance has not been called yet on this row.
   */
  private async startTextExtraction(doc: DocumentUpload): Promise<void> {
    try {
      // Get the local file path from the URL
      const filePath = this.getLocalFilePath(doc.file_url);

      const result = await this.aiService.triggerExtractText({
        file_path: filePath,
        mime_type: doc.mime_type || 'application/octet-stream',
      });

      doc.processing_status = DocumentProcessingStatus.EXTRACTING_TEXT;
      doc.processing_job_id = result.job_id;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
    } catch (error) {
      this.logger.error(
        `[startTextExtraction] Text extraction failed for document ${doc.id}: ${error.message}`,
        error.stack,
      );
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = `Text extraction failed to start: ${error.message}`;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
      // SYNC-DISPATCH FAILURE TERMINAL — refund the reservation.
      await this.releaseReservationOnFailure(doc);
    }
  }

  /**
   * Poll the current job and advance the pipeline if complete.
   *
   * Tenant-isolation Tier 2 — CHILD-KEYED route
   * (`GET /contracts/:contractId/documents/:docId/status`). The URL
   * `:contractId` is decorative; the service only uses `:docId`. Per the
   * PR #45 lesson, do NOT trust the URL contractId — load the doc by
   * id, then walk `doc.contract_id → findInOrg(_, orgId)`.
   */
  async pollAndAdvance(docId: string, orgId: string): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
      where: { id: docId },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Tenant wall — walk doc → contract → org. Throws 404 if the doc's
    // contract belongs to another org. Mirrors the reprocess pattern
    // shipped in Tier 1. MANAGING wall — UNCHANGED.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);

    return this.advanceDocumentState(doc);
  }

  /**
   * Guest sibling of pollAndAdvance — drives the SAME extraction-advance core
   * for a bound guest's own new-version upload, walled by the guest CONTRACT
   * BINDING (`guest_contract_access`) instead of `findInOrg`.
   *
   * The managing status route (`GET /contracts/:contractId/documents/:docId/status`)
   * is UNTOUCHED — it keeps its `findInOrg` wall. This is an additive guest
   * path; it never loosens the managing wall.
   *
   * Three 404-on-mismatch gates (no existence leak):
   *   (a) the doc must exist;
   *   (b) `:docId` must belong to `:contractId` AND be THIS guest's own upload
   *       (`uploaded_by === guestUserId`) — a guest can only drive a document
   *       they uploaded via the guest path, never the host's original doc nor
   *       another guest's;
   *   (c) the guest must be bound to `:contractId` via `guest_contract_access`.
   *
   * The proposed-vs-live + party-backfill behaviour is NOT decided here — it is
   * INTRINSIC to the document (derived from the uploader's account_type inside
   * advanceDocumentState). A guest-uploaded doc ALWAYS writes proposed clauses
   * and never backfills, no matter which route drives it. That closes the race
   * where a host polling a guest's in-progress doc via the managing status
   * route would otherwise write LIVE clauses + party-backfill.
   *
   * The metering COMMIT on terminal success happens inside the shared core
   * (commitReservationOnSuccess, keyed on doc.reservation_id) — so a guest run
   * that reaches CLAUSES_EXTRACTED commits the GUEST_UPLOAD reservation instead
   * of leaving it to be swept/refunded.
   */
  async pollAndAdvanceForGuest(
    docId: string,
    contractId: string,
    guestUserId: string,
  ): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({ // lint-exempt: wall-protected (guest binding); chokepoint migration scheduled
      where: { id: docId },
    });

    // (a) doc existence; (b) URL coherence + guest ownership. All 404 — a
    // guest learns nothing about documents outside their own upload.
    if (
      !doc ||
      doc.contract_id !== contractId ||
      doc.uploaded_by !== guestUserId
    ) {
      throw new NotFoundException('Document not found');
    }

    // (c) BINDING WALL — the guest must hold a guest_contract_access row for
    // this contract. Lightweight (no contract load) for the ~2s status poll.
    await this.contractAccess.assertGuestContractAccess(contractId, guestUserId);

    return this.advanceDocumentState(doc);
  }

  /**
   * Is this document a GUEST-CHANNEL upload? DOC-derived (never
   * endpoint-derived), so the proposed-vs-live decision is intrinsic to the
   * document and identical no matter which route (managing status poll,
   * guest status poll, or the SYSTEM driver) drives the advance:
   *   - uploader is a GUEST account → guest channel (the pre-unified rule);
   *   - uploader is a REAL account (MANAGING/FREE) holding a
   *     guest_contract_access binding for THIS contract → guest channel too
   *     (unified membership: they act as a guest ON this contract — proposed
   *     clauses, no party backfill).
   * Both discriminators are durable row facts (uploader identity + binding).
   */
  private async isGuestUploadedDoc(doc: DocumentUpload): Promise<boolean> {
    const uploader = await this.userRepository.findOne({
      where: { id: doc.uploaded_by },
      select: ['id', 'account_type'],
    });
    if (uploader?.account_type === AccountType.GUEST) {
      return true;
    }
    if (!doc.uploaded_by || !doc.contract_id) {
      return false;
    }
    return this.contractAccess.hasGuestBinding(doc.contract_id, doc.uploaded_by);
  }

  /**
   * Shared extraction-advance core. Runs AFTER the caller's access wall has
   * authorized the doc (findInOrg for managing, binding + ownership for guest).
   * Polls the current job and advances the pipeline one step, owning the
   * terminal metering commit/release.
   *
   * The ONLY behavioural divergence — whether extracted clauses are the Option-C
   * "proposed" set and whether the parent contract's party fields may be
   * backfilled — is derived from the DOCUMENT (isGuestUploadedDoc), NOT from the
   * calling endpoint. So a guest-uploaded doc is always treated as a guest
   * upload even if a host's managing poll happens to drive it.
   */
  private async advanceDocumentState(
    doc: DocumentUpload,
  ): Promise<DocumentUpload> {
    if (
      doc.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED ||
      doc.processing_status === DocumentProcessingStatus.FAILED ||
      doc.processing_status === DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED
    ) {
      return doc;
    }

    // Signed-state pinning (Slice 2) — the SYSTEM driver (and any browser
    // poll sharing this advance core) must NEVER advance/write clauses or
    // backfill parties for a PINNED contract. A background writer can't
    // surface a 409 to anyone, so instead of throwing we TERMINALIZE: the doc
    // FAILs loudly (error_message names CONTRACT_PINNED) + the reservation is
    // refunded — same self-termination guarantee as the staleness backstop
    // (an in-flight extraction that outlived the signing must not re-poll
    // forever, and its result is discarded, never written).
    if (
      await isContractPinned(
        this.documentUploadRepository.manager,
        doc.contract_id,
      )
    ) {
      return this.failPinnedDoc(doc);
    }

    if (!doc.processing_job_id) {
      // No live AI job to poll. Normally a sub-second transient state
      // (UPLOADED before text-dispatch, or TEXT_EXTRACTED between the text-claim
      // and clause-dispatch). If a row rests here beyond the max window, a crash
      // stranded the winner mid-dispatch (the lesson #161 class) → terminalize
      // it so the SERVER driver self-terminates instead of leaving a row no
      // driver ever advances. Otherwise leave it for the in-flight winner.
      if (this.isStaleInProgress(doc)) return this.failStaleDoc(doc);
      return doc;
    }

    const jobStatus = await this.aiService.getJobStatus(doc.processing_job_id);

    if (jobStatus.status === 'failed') {
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = jobStatus.error || 'Processing failed';
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
      // Phase 7.18 Part 3 — ASYNC TERMINAL FAILURE. The AI job reported
      // failed (text-extraction OR clause-extraction; both flow through
      // here). Refund the reservation. Inspect TransitionResult inside
      // the helper; emit observable signal on {applied:false}.
      await this.releaseReservationOnFailure(doc);
      return doc;
    }

    if (jobStatus.status !== 'completed') {
      // Still processing — OR the AI job is dead and its Celery result has
      // expired. Celery's AsyncResult reports an unknown / expired task as
      // PENDING, so a doc whose result aged out would otherwise be re-polled
      // FOREVER and never terminalize. If it has not completed within the max
      // window (well beyond the Celery hard time-limit), treat it as dead and
      // FAIL it so the driver self-terminates. Race-safe + at-most-once.
      if (this.isStaleInProgress(doc)) return this.failStaleDoc(doc);
      return doc;
    }

    // Intrinsic to the document, not the caller: a guest upload writes proposed
    // clauses and never backfills the parent contract's party fields.
    const isGuestUpload = await this.isGuestUploadedDoc(doc);

    // Job completed — advance pipeline
    if (doc.processing_status === DocumentProcessingStatus.EXTRACTING_TEXT) {
      // Text extraction complete
      const textResult = jobStatus.result?.result || jobStatus.result;
      const rawText = textResult?.text || '';
      const pageCount = textResult?.page_count || 0;

      // Phase 7.25 — quality flags from the OCR pipeline.
      const qualityFlags: string[] = Array.isArray(textResult?.quality_flags)
        ? (textResult.quality_flags as string[])
        : [];

      // Trim cover pages / TOC before saving so both the DB and clause
      // extraction receive the cleaned text. Label-INDEPENDENT + clause-guard:
      // a numbered clause-1 marker is NEVER trimmed away (see cover-trim.util).
      const trim = computeCoverTrim(rawText, doc.document_label);
      const trimmedText = trim.text;
      if (trim.warning) {
        this.logger.warn(
          `[trimCoverPages] document ${doc.id} (contract ${doc.contract_id}): ${trim.warning}`,
        );
      }

      // RACE-SAFE CLAIM (lesson #177 idiom). The server backstop driver and any
      // browser poll (guest or managing) can all observe "text job completed"
      // at once → without a guard, two drivers both dispatch clause extraction
      // = a wasted ~4-min Anthropic clause run. Atomically move
      // EXTRACTING_TEXT → TEXT_EXTRACTED; 0 rows affected ⇒ a peer already
      // claimed it → no-op. (The downstream EXTRACTING_CLAUSES guard still makes
      // the final clause-write exactly-once even if a duplicate job ever slips
      // through; this claim just avoids the wasted dispatch.)
      const claim = await this.documentUploadRepository.update( // lint-exempt: S2f-deferred (metering-entangled, walled)
        {
          id: doc.id,
          processing_status: DocumentProcessingStatus.EXTRACTING_TEXT,
        },
        { processing_status: DocumentProcessingStatus.TEXT_EXTRACTED },
      );
      if (claim.affected !== 1) {
        return (
          (await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
            where: { id: doc.id },
          })) ?? doc
        );
      }

      // WINNER — persist the text result + decide the next state.
      doc.page_count = pageCount;
      // OCR scan-quality flags (blur/contrast/rotation) drive the
      // HUMAN_REVIEW_RECOMMENDED parking below. The cover-trim clause-guard flag
      // is OBSERVABILITY only — it must NOT park the doc — so it is merged into
      // the STORED flags but excluded from the parking decision (which stays on
      // `qualityFlags`).
      const storedFlags = [...qualityFlags, ...trim.flags];
      doc.quality_flags = storedFlags.length > 0 ? storedFlags : null;
      doc.extracted_text = trimmedText;

      // Phase 7.25 — poor scan quality parks the doc in HUMAN_REVIEW_RECOMMENDED
      // (terminal) instead of advancing to clause extraction. The partial
      // extracted_text is still saved.
      if (qualityFlags.length > 0) {
        this.logger.warn(
          `[advanceDocumentState] Poor scan quality detected for document ${doc.id}: [${qualityFlags.join(', ')}]. ` +
          `Setting status to HUMAN_REVIEW_RECOMMENDED.`,
        );
        doc.processing_status = DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED;
        doc.processing_job_id = null;
        await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
        // Phase 7.18 Part 3 — PARKED-TERMINAL state. No clauses were extracted;
        // refund the reservation (reprocess takes a fresh one — new intent).
        await this.releaseReservationOnFailure(doc);
        return doc;
      }

      doc.processing_status = DocumentProcessingStatus.TEXT_EXTRACTED;
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)

      // ── Contract-party extraction (regex-first + Haiku fallback) ──────────
      // Runs on the RAW text's PREAMBLE window (before clause 1), NOT the trimmed
      // text: computeCoverTrim removes English preambles, and scoping to the
      // preamble stops body cross-references (e.g. "between the Attachments")
      // from being scraped into a party slot. Regex-first, Haiku fallback only on
      // a partial result, best-result-wins across the contract's documents, never
      // over a human edit. SUPPRESSED for guest uploads — a guest must NEVER
      // mutate the parent contract's fields. See
      // docs/parties-extraction-bug-investigation.md.
      if (!isGuestUpload) {
        await this.backfillPartiesFromPreamble(doc.contract_id, rawText);
      }

      // Immediately trigger clause extraction
      await this.startClauseExtraction(doc);
    } else if (
      doc.processing_status === DocumentProcessingStatus.EXTRACTING_CLAUSES
    ) {
      // Clause extraction complete
      const clauseResult = jobStatus.result?.result || jobStatus.result;
      const extractedClauses = clauseResult?.clauses || [];

      // (D/E) Observability flags from the AI merge: `clause_dedup_dropped:<n>`
      // when the content-aware dedup removes duplicates, and
      // `combined_conditions_file` when a بند numbering restart suggests GC+PC
      // are in one file. Persisted so silent clause loss is VISIBLE. These do
      // NOT park the doc — parking is OCR-flags-only in the text-extraction path.
      const clauseFlags: string[] = Array.isArray(clauseResult?.quality_flags)
        ? (clauseResult.quality_flags as string[])
        : [];
      const mergedQualityFlags = [...(doc.quality_flags ?? []), ...clauseFlags];

      // RACE-SAFE EXACTLY-ONCE FINALIZE (lesson #177 idiom). The server backstop
      // driver and any browser poll (guest or managing) can all observe "clause
      // job completed" at once → without a guard that is a DOUBLE clause-write +
      // double commit. An atomic conditional UPDATE inside a transaction claims
      // the EXTRACTING_CLAUSES → CLAUSES_EXTRACTED transition: only the caller
      // whose UPDATE affects exactly 1 row (still EXTRACTING_CLAUSES) writes the
      // clauses, IN THE SAME TRANSACTION — so the clauses + terminal status
      // become visible atomically and a crash mid-write rolls back (doc stays
      // EXTRACTING_CLAUSES → retried by the next driver). Concurrent losers
      // (affected=0) no-op: the clauses are written EXACTLY ONCE regardless of
      // how many drivers race. (`manager.transaction` reuses the repo's
      // connection — no DataSource injection needed.)
      const won = await this.documentUploadRepository.manager.transaction(
        async (em) => {
          const claim = await em.update( // lint-exempt: S2f-deferred (metering-entangled, walled); transaction-scoped finalize claim
            DocumentUpload,
            {
              id: doc.id,
              processing_status: DocumentProcessingStatus.EXTRACTING_CLAUSES,
            },
            {
              processing_status: DocumentProcessingStatus.CLAUSES_EXTRACTED,
              processing_job_id: null,
              quality_flags:
                mergedQualityFlags.length > 0 ? mergedQualityFlags : null,
            },
          );
          if (claim.affected !== 1) return false;
          await this.writeClausesInTx(
            em,
            extractedClauses,
            doc.contract_id,
            doc.id,
            doc.uploaded_by,
            doc.organization_id,
            isGuestUpload,
          );
          return true;
        },
      );

      if (!won) {
        // Lost the race — a peer already finalized this doc. Return the fresh
        // (terminal) view; do NOT write clauses or commit again.
        return (
          (await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
            where: { id: doc.id },
          })) ?? doc
        );
      }

      doc.processing_status = DocumentProcessingStatus.CLAUSES_EXTRACTED;
      doc.processing_job_id = null;
      doc.quality_flags =
        mergedQualityFlags.length > 0 ? mergedQualityFlags : null;

      // Phase 7.18 Part 3 — ASYNC TERMINAL SUCCESS. Clauses are now in the DB;
      // commit the reservation. The engine commit is itself status-guarded
      // (at-most-once), so a stray concurrent commit is a no-op — but only the
      // race-winner reaches here anyway. {applied:false} is logged as the
      // swept-then-uncharged hazard.
      await this.commitReservationOnSuccess(doc);
    }

    return doc;
  }

  /**
   * SYSTEM driver entry — the browser-INDEPENDENT backstop. Loads the doc fresh
   * and runs the race-safe advance ONE step, with NO principal and NO access
   * wall (this is the platform's own background driver, invoked by the
   * `document-processing-jobs` repeatable scheduler). advanceDocumentState
   * self-no-ops on terminal / no-job docs and is race-safe (atomic conditional
   * transitions), so this is safe to call on any scanned in-progress row even
   * while a guest's / host's browser poll drives the SAME doc concurrently.
   * Returns null if the doc vanished between the scan and the load.
   */
  async advanceInProgressAsSystem(
    docId: string,
  ): Promise<DocumentUpload | null> {
    const doc = await this.documentUploadRepository.findOne({ // lint-exempt: system/no-orgId (processor)
      where: { id: docId },
    });
    if (!doc) return null;
    return this.advanceDocumentState(doc);
  }

  /**
   * Max time a document may sit in a non-terminal in-progress state before the
   * driver treats it as DEAD and FAILs it (the self-termination guarantee).
   * 60 min is comfortably beyond the Celery hard time-limit (2400s = 40 min, at
   * which Celery KILLS the task → it surfaces as a `failed` job, not a pending
   * one), so a still-running job is never failed prematurely; only a job that is
   * genuinely dead or whose Celery result has expired (AsyncResult → PENDING
   * forever) trips this.
   */
  private static readonly MAX_IN_PROGRESS_MS = 60 * 60 * 1000;

  private static readonly STALE_ERROR_MESSAGE =
    'Extraction timed out: the AI job did not complete within the allowed window ' +
    '(its result is no longer available). Please re-upload to retry.';

  /** True if the doc has rested in its current in-progress state past the max window. */
  private isStaleInProgress(doc: DocumentUpload): boolean {
    const ref = doc.updated_at ?? doc.created_at;
    if (!ref) return false;
    return (
      Date.now() - new Date(ref).getTime() >
      DocumentProcessingService.MAX_IN_PROGRESS_MS
    );
  }

  /**
   * Terminalize a stale / dead in-progress doc as FAILED + refund its
   * reservation — the driver's self-termination backstop for docs that can
   * never complete (crash-stranded with no live job, or a dead/expired AI job
   * that reports PENDING forever). Race-safe: the atomic conditional UPDATE
   * flips FAILED only from the doc's CURRENT in-progress status, so a peer that
   * just completed/failed it wins and this no-ops (returns the fresh view). The
   * reservation release is engine status-guarded (at-most-once).
   */
  /**
   * Signed-state pinning (Slice 2) — terminalize an in-progress doc whose
   * contract got PINNED while extraction was in flight. Same race-safe
   * status-guarded claim as failStaleDoc: exactly one caller flips the row;
   * the AI result is DISCARDED (no clause write, no party backfill) and the
   * reservation is refunded.
   */
  private static readonly PINNED_ERROR_MESSAGE =
    'CONTRACT_PINNED — the contract was signed while this document was ' +
    'processing; the extraction result was discarded because a signed ' +
    "contract's clause set is frozen.";

  private async failPinnedDoc(doc: DocumentUpload): Promise<DocumentUpload> {
    const claim = await this.documentUploadRepository.update( // lint-exempt: S2f-deferred (metering-entangled, walled); pinned-contract terminalize claim
      { id: doc.id, processing_status: doc.processing_status },
      {
        processing_status: DocumentProcessingStatus.FAILED,
        processing_job_id: null,
        error_message: DocumentProcessingService.PINNED_ERROR_MESSAGE,
      },
    );
    if (claim.affected !== 1) {
      // A peer transitioned it first — return the fresh (terminal) view.
      return (
        (await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
          where: { id: doc.id },
        })) ?? doc
      );
    }
    this.logger.warn(
      `[advanceDocumentState] Document ${doc.id} terminalized: contract ` +
        `${doc.contract_id} is PINNED (signed) — extraction result discarded. ` +
        `metering.upload_extraction.pinned_discarded`,
    );
    doc.processing_status = DocumentProcessingStatus.FAILED;
    doc.processing_job_id = null;
    doc.error_message = DocumentProcessingService.PINNED_ERROR_MESSAGE;
    await this.releaseReservationOnFailure(doc);
    return doc;
  }

  private async failStaleDoc(doc: DocumentUpload): Promise<DocumentUpload> {
    const claim = await this.documentUploadRepository.update( // lint-exempt: S2f-deferred (metering-entangled, walled); stale-doc terminalize claim
      { id: doc.id, processing_status: doc.processing_status },
      {
        processing_status: DocumentProcessingStatus.FAILED,
        processing_job_id: null,
        error_message: DocumentProcessingService.STALE_ERROR_MESSAGE,
      },
    );
    if (claim.affected !== 1) {
      // A peer transitioned it first — return the fresh (terminal) view.
      return (
        (await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
          where: { id: doc.id },
        })) ?? doc
      );
    }
    this.logger.warn(
      `[advanceDocumentState] Stale in-progress document ${doc.id} ` +
        `(status was ${doc.processing_status}) failed by the driver backstop — ` +
        `AI job dead or result expired. metering.upload_extraction.stale_failed`,
    );
    doc.processing_status = DocumentProcessingStatus.FAILED;
    doc.processing_job_id = null;
    doc.error_message = DocumentProcessingService.STALE_ERROR_MESSAGE;
    await this.releaseReservationOnFailure(doc);
    return doc;
  }

  // Cover-page / TOC / preamble trimming now lives in
  // ./utils/cover-trim.util (computeCoverTrim): label-INDEPENDENT and
  // clause-guarded (a numbered clause-1 marker is never trimmed away). The old
  // label-driven trimCoverPages silently cut clauses when a Conditions doc was
  // mislabeled "Contract Agreement" and a body phrase matched bare "تم الاتفاق".

  /**
   * Extract contract parties from a document's preamble window and backfill the
   * contract's party_first_name / party_second_name. Regex-first (Arabic +
   * English), Haiku fallback only on a partial result, best-result-wins across
   * the contract's documents, and NEVER over a human edit (guarded in
   * resolveParties AND in the UPDATE's WHERE clause). Best-effort: any failure is
   * logged, never thrown — party backfill is a non-critical side effect of
   * extraction. See docs/parties-extraction-bug-investigation.md.
   */
  private async backfillPartiesFromPreamble(
    contractId: string,
    rawText: string,
  ): Promise<void> {
    const preamble = computePreambleWindow(rawText);
    // No preamble (Conditions / TOC / annex document opens at clause 1) — nothing
    // to extract; scoping to the preamble is what prevents body-name scraping.
    if (!preamble.trim()) return;

    try {
      const contract = await this.contractRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
        where: { id: contractId },
      });
      if (!contract) return;

      const decision = await resolveParties(
        preamble,
        {
          firstParty: contract.party_first_name ?? null,
          secondParty: contract.party_second_name ?? null,
          edited: !!contract.is_parties_edited_by_user,
        },
        (p) => this.aiExtractParties(p),
      );
      if (!decision.write) return;

      await this.contractRepository.update( // lint-exempt: S2f-deferred (metering-entangled, walled)
        // Human-edit guard repeated in the WHERE clause — defense in depth
        // against a human edit landing concurrently with this backfill.
        { id: contractId, is_parties_edited_by_user: false },
        {
          party_first_name: decision.parties.firstParty,
          party_second_name: decision.parties.secondParty,
        },
      );
      this.logger.log(
        `Extracted parties for contract ${contractId} ` +
          `(regex${decision.usedAi ? '+haiku' : ''}): ` +
          `"${decision.parties.firstParty}" / "${decision.parties.secondParty}"`,
      );
    } catch (err) {
      this.logger.warn(
        `Party extraction failed for contract ${contractId}: ${err?.message}`,
      );
    }
  }

  /**
   * Haiku fallback for party extraction — calls the synchronous ai-backend
   * endpoint and maps the response to ExtractedParties. Caps the preamble sent to
   * bound cost/latency. Throws on failure (resolveParties catches it and keeps
   * the regex result).
   */
  private async aiExtractParties(preamble: string): Promise<ExtractedParties> {
    const res = await this.aiService.triggerExtractParties({
      preamble_text: preamble.slice(0, 4000),
    });
    return {
      firstParty: res?.first_party?.trim() || null,
      secondParty: res?.second_party?.trim() || null,
    };
  }

  /**
   * Trigger clause extraction for a document with extracted text.
   *
   * Phase 7.18 Part 3 — second SYNC-DISPATCH terminal failure path. Same
   * shape as startTextExtraction: FAILED is terminal, refund the meter.
   */
  private async startClauseExtraction(doc: DocumentUpload): Promise<void> {
    try {
      const contract = await this.contractRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
        where: { id: doc.contract_id },
      });

      // Text is already trimmed when saved to DB in pollAndAdvance()
      const result = await this.aiService.triggerExtractClauses({
        contract_id: doc.contract_id,
        full_text: doc.extracted_text || '',
        contract_type: contract?.contract_type,
        document_label: doc.document_label || undefined,
        org_id: doc.organization_id,
      });

      doc.processing_status = DocumentProcessingStatus.EXTRACTING_CLAUSES;
      doc.processing_job_id = result.job_id;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
    } catch (error) {
      this.logger.error(
        `[startClauseExtraction] Clause extraction failed for document ${doc.id}: ${error.message}`,
        error.stack,
      );
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = `Clause extraction failed to start: ${error.message}`;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
      // SYNC-DISPATCH FAILURE TERMINAL — refund the reservation.
      await this.releaseReservationOnFailure(doc);
    }
  }

  /**
   * Create Clause + ContractClause records from extracted data, INSIDE the
   * caller's transaction (the race-safe finalize). Writing through the
   * transaction's EntityManager makes the clause inserts atomic with the
   * EXTRACTING_CLAUSES → CLAUSES_EXTRACTED status flip that gated entry here, so
   * only the race-winner ever persists clauses and a crash mid-write rolls the
   * whole thing back (doc stays EXTRACTING_CLAUSES → retried).
   *
   * `isProposed` (Option C) — when true the junction rows are flagged
   * is_proposed=true so the extracted clauses form a SEPARATE pile excluded from
   * every default read (guest new-version upload); false → the contract's live
   * clause set (managing path, byte-unchanged).
   */
  private async writeClausesInTx(
    em: EntityManager,
    extractedClauses: Array<{
      title: string;
      content: string;
      clause_type: string;
      section_number?: string;
      confidence: number;
    }>,
    contractId: string,
    documentId: string,
    userId: string,
    orgId: string,
    isProposed: boolean,
  ): Promise<void> {
    for (let i = 0; i < extractedClauses.length; i++) {
      const ec = extractedClauses[i];

      // Create the clause record
      const clause = em.create(Clause, {
        organization_id: orgId,
        title: ec.title,
        content: ec.content,
        clause_type: ec.clause_type,
        version: 1,
        is_active: true,
        source: ClauseSource.AI_EXTRACTED,
        source_document_id: documentId,
        confidence_score: ec.confidence,
        review_status: ClauseReviewStatus.PENDING_REVIEW,
        created_by: userId,
      });

      const savedClause = await em.save(clause); // lint-exempt: system/no-orgId (processor); transaction-scoped finalize

      // Create the contract-clause junction
      const contractClause = em.create(ContractClause, {
        contract_id: contractId,
        clause_id: savedClause.id,
        section_number: ec.section_number || null,
        order_index: i,
        is_proposed: isProposed,
      });

      await em.save(contractClause); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause); transaction-scoped finalize
    }

    this.logger.log(
      `Created ${extractedClauses.length} ${isProposed ? 'PROPOSED ' : ''}clauses for contract ${contractId} from document ${documentId}`,
    );
  }

  /**
   * Host-v1 read of a guest upload's PROPOSED clauses (Option C). Managing-only
   * — walled by `findInOrg` (cross-tenant probe → 404). Returns ONLY the
   * `is_proposed = true` junction rows whose clause was extracted from the given
   * guest upload (`source_document_id = docId`), ordered by the proposed pile's
   * own `order_index`. These are the clauses excluded from every default read;
   * this is the single surface that exposes them, for the host to review the
   * guest's submitted version.
   */
  async getProposedClauses(
    contractId: string,
    docId: string,
    orgId: string,
  ): Promise<ContractClause[]> {
    await this.contractAccess.findInOrg(contractId, orgId);
    return this.contractClauseRepository // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause)
      .createQueryBuilder('cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .where('cc.contract_id = :contractId', { contractId })
      .andWhere('cc.is_proposed = true')
      .andWhere('clause.source_document_id = :docId', { docId })
      .orderBy('cc.order_index', 'ASC')
      .getMany();
  }

  /**
   * Get all documents for a contract.
   *
   * Two checks, two layers (CLAUDE.md Option B):
   *   layer 1 (persona — Tier 2 wall): `findInOrg(contractId, orgId)` →
   *     cross-tenant probe → 404 BEFORE any data load. Stays independent.
   *   layer 2 (tenancy — Option B S2f scoped chokepoint): the list loads
   *     through `scopedFind`, which independently re-applies the canonical
   *     document→contract→project→org join — cross-tenant rows are excluded
   *     even if the wall above were bypassed.
   * No nested relations on this read → no two-step hydrate; the
   * priority/created ordering is applied on the entity alias by scopedFind.
   */
  async getDocuments(contractId: string, orgId: string): Promise<DocumentUpload[]> {
    await this.contractAccess.findInOrg(contractId, orgId);
    return this.documentScoped.scopedFind(
      { contract_id: contractId },
      orgId,
      { order: { document_priority: 'ASC', created_at: 'ASC' } },
    );
  }

  /**
   * Update the extracted text of a document (manual correction).
   *
   * Tenant-isolation (S2f Phase 1) — CHILD-KEYED. Was gated ONLY on the
   * DENORMALIZED `organization_id` column (`findOne({ id, organization_id })`),
   * with no canonical wall. That column can drift from the canonical
   * `contract → project → organization_id` truth (the same drift class S2c-1 /
   * S2e proved reachable), so a document whose denorm org reads as the caller's
   * while its contract belongs to ANOTHER org was writable — a cross-org write.
   * Load the doc by id, then wall its canonical contract:
   * `doc.contract_id → findInOrg(_, orgId)` → 404 on a cross-tenant probe
   * (never 403 — no existence leak). The canonical contract is now the tenancy
   * authority; the denorm column is no longer trusted. Same wall shape as
   * pollAndAdvance / reprocess (PR #45).
   *
   * S2f Phase 2 — two checks, two layers (CLAUDE.md Option B):
   *   layer 2 (tenancy — scoped chokepoint): `scopedFindByIdOrThrow` resolves
   *     the document through the canonical document→contract→project→org join.
   *     Cross-org → 404 (never 403, no existence leak) at the data layer.
   *   layer 1 (persona — Phase 1 wall): `findInOrg` on the scoped row's
   *     canonical contract STAYS as defense-in-depth.
   * No nested relations needed for a text correction, so the scoped row is
   * mutated and saved directly (it carries every `document` column — the
   * scoped query inner-joins for filtering, not selecting).
   */
  async updateExtractedText(
    docId: string,
    orgId: string,
    text: string,
  ): Promise<DocumentUpload> {
    // SCOPED LOAD (tenancy — layer 2): cross-org denied at the data layer.
    const doc = await this.documentScoped.scopedFindByIdOrThrow(docId, orgId);
    // WALL (persona — Phase 1, layer 1): stays as defense-in-depth.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);
    // Signed-state pinning (Slice 2) — the extracted source text feeds the
    // clause pipeline; frozen on a pinned contract.
    await assertContractMutable(
      this.documentUploadRepository.manager,
      doc.contract_id,
    );
    doc.extracted_text = text;
    return this.documentUploadRepository.save(doc); // lint-exempt: two-step hydration (ids validated by scoped load)
  }

  /**
   * Reprocess a failed document.
   *
   * Tenant-isolation Tier 1 — `orgId` is now required (was missing).
   * After loading the doc by id, walk to its `contract_id` and verify
   * the contract is in the caller's org via `findInOrg`. Cross-tenant
   * probe → 404; in-org reprocess unchanged.
   *
   * Phase 7.18 Part 3 — METERED as a NEW INTENT.
   *   Each user-initiated reprocess is a distinct user click that
   *   triggers fresh Celery dispatch + Anthropic token cost. Per the
   *   intent-level principle (Rule 9 invariant; CLAUDE.md Phase 7.18
   *   Part 2 hard rule 2), each new intent = one new reserve. The
   *   previous reservation_id is already in a terminal state (the doc's
   *   previous FAILED / HUMAN_REVIEW_RECOMMENDED status was terminal
   *   and pollAndAdvance + the sync-dispatch helpers already released
   *   it). The new reservation_id OVERWRITES the column, mirroring
   *   compliance's re-run-as-new-reserve treatment.
   *
   *   The internal 4× Anthropic API retries on the Celery side still
   *   live inside this new unit (lesson #150-class invariant: retries
   *   reuse the same idempotency_key inside Celery, never re-reserve).
   */
  async reprocess(
    docId: string,
    orgId: string,
    options?: { account_type?: MeteringCaller['account_type'] },
  ): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({ // lint-exempt: S2f-deferred (metering-entangled, walled)
      where: { id: docId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Tenant wall — walk doc → contract → org. Throws 404 if the doc's
    // contract belongs to another org.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);

    // Signed-state pinning (Slice 2) — AFTER the wall, BEFORE any release/
    // reserve: reprocessing re-runs extraction and rewrites clauses; frozen
    // on a pinned contract (409, no metering churn).
    await assertContractMutable(
      this.documentUploadRepository.manager,
      doc.contract_id,
    );

    // ─────────────────────────────────────────────────────────────────────
    // Phase 7.18 Part 3 — DEFENSE-IN-DEPTH: release any prior reservation
    // BEFORE issuing the new one.
    //
    // Why: reprocess is NOT gated by status at this layer (the frontend
    // gates "Retry OCR" to FAILED / HUMAN_REVIEW_RECOMMENDED rows, but the
    // backend doesn't enforce that convention). On the happy path the
    // prior reservation is already in a terminal state (committed when
    // the prior poll cycle hit CLAUSES_EXTRACTED; released when it hit
    // FAILED or HUMAN_REVIEW_RECOMMENDED) and this call is a no-op
    // (engine returns {applied:false, status:<terminal>}). On a bypassed-
    // frontend / racing-double-click / in-progress reprocess, the prior
    // is still `reserved` — this release refunds it so the new reserve
    // doesn't temporally double-count against the per_contract window
    // until the sweeper backstop fires at TTL.
    //
    // Idempotent by construction: engine `release()` uses an atomic
    // status-guarded UPDATE (WHERE status='reserved'); terminal priors
    // affect 0 rows; refund branch unreachable. No double-refund.
    //
    // ORDER (matters): (1) release prior → (2) reserve new → (3) overwrite
    // doc.reservation_id with the new id. Releasing AFTER overwriting
    // would strand the prior with no carrier; reserving BEFORE releasing
    // would briefly over-count even on the happy path under realistic
    // poller cadence.
    // ─────────────────────────────────────────────────────────────────────
    if (doc.reservation_id) {
      await this.releaseReservationOnFailure(doc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Phase 7.18 Part 3 — METERING reserve. Same shape as uploadAndProcess:
    // downstream of the access wall, upstream of cleanup + dispatch.
    // ─────────────────────────────────────────────────────────────────────
    const reservation = await this.metering.reserve({
      caller: {
        user_id: doc.uploaded_by,
        jwt_organization_id: orgId,
        account_type: options?.account_type ?? 'MANAGING',
      },
      meterKey: MeterKey.UPLOAD_EXTRACTION,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId: doc.contract_id,
      actorRef: doc.uploaded_by,
      metadata: {
        route: 'POST /contracts/:contractId/documents/:docId/reprocess',
        previous_reservation_id: doc.reservation_id ?? null,
      },
    });

    try {
      // ── Cleanup: remove clauses from any previous extraction of this document ──
      // Find all clause IDs that were extracted from this document upload.
      const previousClauses = await this.clauseRepository.find({
        where: { source_document_id: docId },
        select: ['id'],
      });

      if (previousClauses.length > 0) {
        const clauseIds = previousClauses.map((c) => c.id);

        // Delete contract_clauses join records first (FK references clauses.id).
        await this.contractClauseRepository.delete({ clause_id: In(clauseIds) }); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause)

        // Then delete the clause records themselves.
        await this.clauseRepository.delete({ source_document_id: docId });

        this.logger.log(
          `reprocess: cleaned up ${previousClauses.length} old clauses for document ${docId}`,
        );
      }
      // ─────────────────────────────────────────────────────────────────────────

      doc.processing_status = DocumentProcessingStatus.UPLOADED;
      doc.error_message = null;
      doc.processing_job_id = null;
      // Phase 7.25 — clear quality flags so a reprocessed document starts fresh.
      doc.quality_flags = null;
      // Phase 7.18 Part 3 — OVERWRITE reservation_id with the new one so
      // pollAndAdvance's commit/release acts on the NEW reservation.
      doc.reservation_id = reservation.reservation_id;
      await this.documentUploadRepository.save(doc); // lint-exempt: S2f-deferred (metering-entangled, walled)
    } catch (err) {
      // Sync failure during cleanup or doc-row reset (before dispatch).
      // The new reservation hasn't been wired into the saved doc yet —
      // release in-request from local state and re-throw.
      await this.releaseReservationInFlight(
        reservation.reservation_id,
        err as Error,
      );
      throw err;
    }

    // Sync-dispatch failure inside startTextExtraction will set FAILED
    // and release via releaseReservationOnFailure (the doc now carries
    // the new reservation_id).
    await this.startTextExtraction(doc);
    return doc;
  }

  /**
   * Get clauses pending review for a contract.
   *
   * Tenant-isolation Tier 2 — wall on URL contractId before the qb runs.
   */
  async getClausesForReview(contractId: string, orgId: string) {
    await this.contractAccess.findInOrg(contractId, orgId);
    return this.contractClauseRepository // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause)
      .createQueryBuilder('cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .leftJoinAndSelect('clause.source_document', 'source_doc')
      .where('cc.contract_id = :contractId', { contractId })
      .andWhere('clause.source = :source', { source: ClauseSource.AI_EXTRACTED })
      // Option C — the managing review screen reviews the contract's LIVE
      // clauses only; guest-PROPOSED clauses are surfaced via the dedicated
      // host-v1 read (getProposedClauses), never mixed into review.
      .andWhere('cc.is_proposed = false')
      .orderBy('source_doc.document_priority', 'ASC')
      .addOrderBy('cc.order_index', 'ASC')
      .getMany();
  }

  /**
   * Update a clause's review status.
   */
  async updateClauseReview(
    clauseId: string,
    data: {
      review_status: ClauseReviewStatus;
      title?: string;
      content?: string;
      clause_type?: string;
    },
    userId: string,
  ): Promise<Clause> {
    // Signed-state pinning (Slice 2) — a review edit rewrites the clause's
    // title/content IN PLACE; blocked when the clause backs ANY pinned
    // contract (clause-level guard: this route has no contract in scope).
    await assertClauseMutable(this.clauseRepository.manager, clauseId);

    const clause = await this.clauseRepository.findOne({
      where: { id: clauseId },
    });
    if (!clause) {
      throw new NotFoundException('Clause not found');
    }

    clause.review_status = data.review_status;
    clause.reviewed_by = userId;
    clause.reviewed_at = new Date();

    if (data.title !== undefined) clause.title = data.title;
    if (data.content !== undefined) clause.content = data.content;
    if (data.clause_type !== undefined) clause.clause_type = data.clause_type;

    return this.clauseRepository.save(clause);
  }

  /**
   * Bulk approve clauses.
   */
  async bulkApproveReview(
    clauseIds: string[],
    userId: string,
  ): Promise<void> {
    // Signed-state pinning (Slice 2) — same clause-level guard as
    // updateClauseReview; one indexed join covers the whole batch.
    await assertClauseMutable(this.clauseRepository.manager, clauseIds);
    await this.clauseRepository
      .createQueryBuilder()
      .update(Clause)
      .set({
        review_status: ClauseReviewStatus.APPROVED,
        reviewed_by: userId,
        reviewed_at: new Date(),
      })
      .whereInIds(clauseIds)
      .execute();
  }

  /**
   * Finalize the review process for a contract.
   * Triggers risk analysis and obligation extraction on approved clauses.
   *
   * Tenant-isolation Tier 1 — HIGHEST blast in this module: a single
   * unguarded call dispatches risk + obligations + conflict AI under
   * the CALLER's `orgId` against a cross-tenant contract. Wall fires
   * BEFORE any qb runs or AI is touched.
   */
  async finalizeReview(
    contractId: string,
    orgId: string,
    options?: {
      /**
       * Phase 7.18 — the acting user's id, threaded from the controller's
       * @CurrentUser(). Used as the metering caller.user_id (cross-check
       * log) AND as the ledger actor_ref (NOT NULL UUID — "who did the
       * work"). The controller route is JWT-guarded, so this is always set
       * in production; left optional so existing direct unit-test callers
       * (which stub pollAndSaveRisks) don't have to thread it.
       */
      user_id?: string;
      /**
       * Caller account_type for the engine's defense-in-depth JWT
       * cross-check (Invariant 1). Defaults to MANAGING — this route is
       * reachable only via the JWT-guarded managing-user controller; the
       * guest portal does NOT call finalizeReview today.
       */
      account_type?: MeteringCaller['account_type'];
    },
  ): Promise<{
    risk_job_id: string;
    obligations_job_id: string;
    conflict_job_id: string | null;
  }> {
    // Tenant wall — throws 404 on cross-tenant probe; AI dispatch never
    // fires under the attacker's org. Reserve sits DOWNSTREAM of this wall.
    await this.contractAccess.findInOrg(contractId, orgId);

    // Signed-state pinning (Slice 2) — finalize drives the review→risk-writer
    // pipeline on the clause set; frozen on a pinned contract (409 BEFORE the
    // reserve — a doomed finalize must not charge or dispatch).
    await assertContractMutable(
      this.documentUploadRepository.manager,
      contractId,
    );

    // ─────────────────────────────────────────────────────────────────────
    // Phase 7.18 — METERING reserve (meter_key=finalize_review).
    //
    // ONE reserve covers the WHOLE 3-agent finalize burst (risk +
    // obligations + conflict) — Ayman's decision: one finalize click = ONE
    // charge, NOT per-agent. Sits DOWNSTREAM of the access wall (already
    // authorized this contract for this org), BEFORE any AI dispatch — so a
    // capacity-exhausted finalize dispatches nothing.
    //
    // Throws MeterLimitExceededError on capacity exhaustion → 403
    // METER_LIMIT_FINALIZE_REVIEW envelope. Throws 5xx-class on a meter
    // SYSTEM error (fail closed per meter_definition.fail_mode='closed').
    //
    // Fresh UUID per finalize: re-finalize is intentionally a NEW intent
    // (no backend cap beyond the per_contract window). The engine's
    // idempotency_key only dedupes an in-flight retry of the SAME reserve.
    //
    // CARRIER DIVERGENCE (vs compliance / upload_extraction): a finalize
    // run writes MANY per-clause risk_analyses rows — there is NO single
    // domain row to hang reservation_id on. So reservation_id is threaded
    // IN-MEMORY into pollAndSaveRisks (the risk poller is the terminal
    // owner of commit/release for the whole burst). No carrier column, no
    // migration. If the process dies mid-finalize, the engine SWEEPER is
    // the SOLE backstop (releases at TTL) — documented in
    // docs/metering-finalize-review.md.
    // ─────────────────────────────────────────────────────────────────────
    const reservation = await this.metering.reserve({
      caller: {
        user_id: options?.user_id ?? null,
        jwt_organization_id: orgId,
        account_type: options?.account_type ?? 'MANAGING',
      },
      meterKey: MeterKey.FINALIZE_REVIEW,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: options?.user_id ?? contractId,
      metadata: { route: 'POST /contracts/:contractId/review/finalize' },
    });

    // From reserve() until the poller is launched with reservation_id, the
    // local `reservation` handle is the ONLY carrier — any throw here MUST
    // release in-request. Once pollAndSaveRisks holds the reservation_id,
    // the poller owns terminal commit (risk completed) / release (risk
    // failed or timed out).
    let clausesForAi: Array<{
      id: string;
      text: string;
      document_id: string | null;
      document_label: string | null;
      document_priority: number;
    }>;
    let riskResult: { job_id: string; status: string };
    try {
      // Get all approved clauses with their source document metadata
      const contractClauses = await this.contractClauseRepository // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled (ContractClause)
        .createQueryBuilder('cc')
        .leftJoinAndSelect('cc.clause', 'clause')
        .leftJoinAndSelect('clause.source_document', 'source_doc')
        .where('cc.contract_id = :contractId', { contractId })
        .andWhere('clause.review_status IN (:...statuses)', {
          statuses: [ClauseReviewStatus.APPROVED, ClauseReviewStatus.EDITED],
        })
        .getMany();

      // Include document metadata so AI can detect cross-document conflicts
      clausesForAi = contractClauses.map((cc) => ({
        id: cc.clause.id,
        text: cc.clause.content,
        document_id: cc.clause.source_document?.id || null,
        document_label: cc.clause.source_document?.document_label || null,
        document_priority: cc.clause.source_document?.document_priority ?? 0,
      }));

      // Trigger risk analysis (with document priority for conflict detection)
      riskResult = await this.aiService.triggerRiskAnalysis({
        contract_id: contractId,
        clauses: clausesForAi,
        org_id: orgId,
      });
    } catch (err) {
      // SYNCHRONOUS dispatch failure (clause load or risk dispatch) BEFORE
      // the poller exists to own the reservation — release in-request, then
      // re-throw. No charge for a finalize that never dispatched.
      await this.releaseFinalizeReservationInFlight(
        reservation.reservation_id,
        err as Error,
      );
      throw err;
    }

    // Phase 7.17 — Prompt 1, A.1: poll the risk job in the background and
    // save per-clause risks. Phase 7.18: this poller is ALSO the terminal
    // owner of the finalize_review reservation — it commits on risk
    // completion (~the completed branch) and releases on risk failure /
    // timeout. The obligations + conflict dispatches below run alongside;
    // if one of them throws, the poller (already launched) still owns the
    // reservation and reconciles via the risk outcome — do NOT release here.
    this.pollAndSaveRisks(
      contractId,
      riskResult.job_id,
      orgId,
      reservation.reservation_id,
    ).catch((err) => {
      this.logger.error(
        `Risk analysis background task failed for contract ${contractId}: ${err.message}`,
      );
    });

    // Trigger obligation extraction (with document priority awareness)
    const obligationsResult = await this.aiService.triggerExtractObligations({
      contract_id: contractId,
      clauses: clausesForAi,
    });

    // Trigger conflict detection if clauses come from multiple documents
    let conflict_job_id: string | null = null;
    const uniqueDocIds = new Set(
      clausesForAi
        .map((c) => c.document_id)
        .filter((id): id is string => id !== null),
    );

    if (uniqueDocIds.size >= 2) {
      try {
        const conflictResult = await this.aiService.triggerConflictDetection({
          contract_id: contractId,
          clauses: clausesForAi,
        });
        conflict_job_id = conflictResult.job_id;
        this.logger.log(
          `Conflict detection dispatched for contract ${contractId}: job_id=${conflict_job_id}`,
        );

        // Poll and save conflicts in background (non-blocking)
        this.pollAndSaveConflicts(contractId, conflict_job_id).catch((err) => {
          this.logger.error(
            `Conflict detection background task failed for contract ${contractId}: ${err.message}`,
          );
        });
      } catch (error) {
        // Conflict detection failure must NOT break finalization
        this.logger.warn(
          `Conflict detection failed to start for contract ${contractId}: ${error.message}`,
        );
      }
    }

    return {
      risk_job_id: riskResult.job_id,
      obligations_job_id: obligationsResult.job_id,
      conflict_job_id,
    };
  }

  /**
   * Poll the conflict detection job and save detected conflicts as risk records.
   * Runs in the background — failures are logged but never thrown.
   */
  private async pollAndSaveConflicts(
    contractId: string,
    jobId: string,
  ): Promise<void> {
    const MAX_POLLS = 60;
    const POLL_INTERVAL_MS = 3000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const jobStatus = await this.aiService.getJobStatus(jobId);

      if (jobStatus.status === 'failed') {
        this.logger.warn(
          `Conflict detection job ${jobId} failed: ${jobStatus.error}`,
        );
        return;
      }

      if (jobStatus.status === 'completed') {
        const result = jobStatus.result?.result || jobStatus.result;
        const conflicts = result?.conflicts || [];

        if (conflicts.length === 0) {
          this.logger.log(
            `No conflicts found for contract ${contractId}`,
          );
          return;
        }

        // Save each conflict as a risk_analyses record
        for (const conflict of conflicts) {
          await this.saveConflictAsRisk(contractId, conflict);
        }

        this.logger.log(
          `Saved ${conflicts.length} document conflicts as risks for contract ${contractId}`,
        );
        return;
      }

      // Still pending/processing — continue polling
    }

    this.logger.warn(
      `Conflict detection job ${jobId} timed out after ${MAX_POLLS} polls`,
    );
  }

  /**
   * Convert a single conflict detection result into a risk_analyses record.
   */
  private async saveConflictAsRisk(
    contractId: string,
    conflict: {
      conflict_id: string;
      type: string;
      description: string;
      document_a: {
        id: string;
        label: string;
        priority: number;
        clause_text: string;
        clause_id: string;
      };
      document_b: {
        id: string;
        label: string;
        priority: number;
        clause_text: string;
        clause_id: string;
      };
      governing_value: string;
      governing_reason: string;
      overridden_value: string;
      severity: string;
      suggestion: string;
    },
  ): Promise<void> {
    // Map conflict severity to RiskLevel enum
    const severityMap: Record<string, RiskLevel> = {
      high: RiskLevel.HIGH,
      medium: RiskLevel.MEDIUM,
      low: RiskLevel.LOW,
    };
    const riskLevel =
      severityMap[conflict.severity?.toLowerCase()] || RiskLevel.MEDIUM;

    // Store document_a details in citation_source (varchar 500 limit)
    const citationSource = `[${conflict.document_a.label}] (priority: ${conflict.document_a.priority}) — Governing: "${conflict.governing_value}"`.substring(0, 500);

    // Store document_b details in citation_excerpt (text, no limit)
    const citationExcerpt = JSON.stringify({
      conflict_id: conflict.conflict_id,
      type: conflict.type,
      document_a: conflict.document_a,
      document_b: conflict.document_b,
      governing_value: conflict.governing_value,
      governing_reason: conflict.governing_reason,
      overridden_value: conflict.overridden_value,
    });

    const risk = this.riskAnalysisRepository.create({
      contract_id: contractId,
      contract_clause_id: null,
      risk_category: 'DOCUMENT_CONFLICT',
      risk_level: riskLevel,
      description: `${conflict.type.replace(/_/g, ' ').toUpperCase()}: ${conflict.description}`,
      recommendation: conflict.suggestion,
      citation_source: citationSource,
      citation_excerpt: citationExcerpt,
      status: 'OPEN',
    });

    await this.riskAnalysisRepository.save(risk); // lint-exempt: S2f-deferred (metering-entangled, walled)
  }

  // ──────────────────────────────────────────────────────────────────────
  // Phase 7.17 — Prompt 1, A.1: Per-clause AI risk writer
  //
  // Before A.1, `finalizeReview()` dispatched the risk-analysis job to
  // the AI backend but the response was never consumed — per-clause
  // risks were silently dropped. A.1 closes that gap by mirroring the
  // pollAndSaveConflicts pattern: poll the job status, then convert
  // each AI risk into a risk_analyses row using the resolver for
  // default L,I and the @BeforeInsert hook for risk_score.
  //
  // See `.claude/plans/delightful-orbiting-zebra.md` (A.1 plan) for
  // the full rationale + Decisions 6-10.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Poll the risk-analysis job and save each returned per-clause risk
   * as a risk_analyses row. Mirrors the pollAndSaveConflicts structure.
   * Runs as a background task from finalizeReview(); failures are logged
   * but never thrown (the contract is "fire-and-forget from caller").
   */
  private async pollAndSaveRisks(
    contractId: string,
    jobId: string,
    orgId: string,
    // Phase 7.18 — the finalize_review reservation this poller OWNS. When
    // set, the poller commits on risk completion and releases on risk
    // failure / timeout (the in-memory carrier — no DB column; see
    // finalizeReview's carrier-divergence note). Undefined for legacy /
    // direct callers (e.g. the ai-risk-writer integration spec) — the
    // commit/release helpers no-op on a missing id.
    reservationId?: string | null,
  ): Promise<void> {
    // Issue 5 — the risk job now runs clauses in concurrent batches; a large
    // contract takes ~2-3 min end-to-end, so the poll window is 100×3s = 5 min
    // (was 60×3s = 3 min, which timed out on the batched run). Well under the
    // metering reservation TTL (1h) — the poller still owns the reservation.
    const MAX_POLLS = 100;
    const POLL_INTERVAL_MS = 3000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const jobStatus = await this.aiService.getJobStatus(jobId);

      if (jobStatus.status === 'failed') {
        this.logger.warn(
          `Risk analysis job ${jobId} failed: ${jobStatus.error}`,
        );
        // TERMINAL FAILURE for the finalize burst — refund the reservation.
        await this.releaseFinalizeReservationOnFailure(
          reservationId,
          contractId,
          `risk job ${jobId} failed`,
        );
        return;
      }

      if (jobStatus.status === 'completed') {
        // TERMINAL SUCCESS for the finalize burst — the AI risk job
        // completed (whether or not any per-clause risks came back). Commit
        // the ONE finalize_review charge here. The obligations + conflict
        // agents ride inside this same charge (Ayman's one-charge model).
        await this.commitFinalizeReservationOnSuccess(reservationId, contractId);

        const result = jobStatus.result?.result || jobStatus.result;
        const risks: any[] = result?.risks || [];

        if (risks.length === 0) {
          this.logger.log(`No per-clause risks found for contract ${contractId}`);
          return;
        }

        // Issue 5 — REPLACE, don't append. Before writing this run's rows, clear
        // the PREVIOUS run's non-human AI risks for the contract so counts stop
        // stacking. Human-edited (is_edited_by_user=true) and merged (merged_at
        // set) rows are PRESERVED and coexist with the new rows. Only runs that
        // actually produced risks reach here (the length===0 early-return above
        // guards a degenerate/empty run from wiping existing coverage). The clear
        // is wall-protected: finalizeReview already ran findInOrg + the pin
        // guard on this contractId.
        // lint-exempt: wall-protected (finalizeReview findInOrg + pin guard); replace-not-append clear
        const cleared = await this.riskAnalysisRepository.delete({
          contract_id: contractId,
          is_edited_by_user: false,
          merged_at: IsNull(),
        });
        this.logger.log(
          `Replace: cleared ${cleared.affected ?? 0} previous non-human AI risks for contract ${contractId}`,
        );

        let saved = 0;
        let skipped = 0;
        for (const aiRisk of risks) {
          const ok = await this.saveAiRiskAsRow(contractId, orgId, aiRisk);
          if (ok) saved++;
          else skipped++;
        }

        this.logger.log(
          `Saved ${saved} AI per-clause risks (${skipped} skipped) for contract ${contractId}`,
        );
        return;
      }

      // Still pending/processing — continue polling
    }

    this.logger.warn(
      `Risk analysis job ${jobId} timed out after ${MAX_POLLS} polls`,
    );
    // TERMINAL TIMEOUT — the poller gives up; refund the reservation. (The
    // engine sweeper would also catch it at TTL, but releasing here returns
    // capacity promptly rather than waiting out RESERVATION_TTL_SECONDS.)
    await this.releaseFinalizeReservationOnFailure(
      reservationId,
      contractId,
      `risk job ${jobId} timed out after ${MAX_POLLS} polls`,
    );
  }

  /**
   * Convert one AI-returned risk dict into a risk_analyses row.
   *
   * Source attribution per plan Decision 8:
   *  - AI returned valid L,I  → use them; source = resolver's source
   *    (USER_KB_REFERENCE / ORG_LEARNED / PLATFORM_DEFAULT) because the
   *    AI is calibrated against that methodology
   *  - AI returned only severity → severity-mapped L,I; source = FALLBACK
   *  - Malformed (no clause_id / description / L+severity) → skip + warn
   *
   * Per plan Decision 9, unknown category → 'Uncategorized' placeholder +
   * audit-log entry, NOT a rejected finding.
   *
   * Per plan Decision 10, the legacy `risk_level` column is populated
   * from `risk_score` via mapScoreToRiskLevel for backward compat.
   *
   * @returns true if a row was saved, false if the finding was skipped.
   */
  private async saveAiRiskAsRow(
    contractId: string,
    orgId: string,
    aiRisk: any,
  ): Promise<boolean> {
    // ── Validate the minimum payload ─────────────────────────────────
    if (
      !aiRisk?.clause_id ||
      !aiRisk?.description ||
      (!Number.isInteger(aiRisk?.likelihood) &&
        typeof aiRisk?.severity !== 'string')
    ) {
      this.logger.warn(
        `Skipping AI risk for contract ${contractId}: malformed payload ` +
          `(missing clause_id/description, or both likelihood and severity)`,
      );
      return false;
    }

    // ── Determine final category (Decision 9) ─────────────────────────
    // Three branches:
    //   - AI gave us nothing → category = 'Uncategorized', no audit
    //     (there is nothing to log — the AI simply omitted the field)
    //   - AI gave us a value that matches an active risk_categories row →
    //     store verbatim, no audit
    //   - AI gave us a value that doesn't match the active taxonomy →
    //     store as 'Uncategorized', audit log the original value
    const rawCategory: string | undefined =
      typeof aiRisk.risk_category === 'string'
        ? aiRisk.risk_category.trim()
        : undefined;

    let aiCategory: string;
    let categoryWasUnrecognized = false;
    if (!rawCategory || rawCategory.length === 0) {
      aiCategory = 'Uncategorized';
    } else {
      // Issue 5 — alias-bridge the AI's category vocabulary onto the taxonomy,
      // then validate case-insensitively. A normalized alias hit maps to the
      // canonical taxonomy name; otherwise the raw value is tried as-is (so an
      // AI value that already IS a taxonomy name still matches). Unmatched →
      // 'Uncategorized' + audit (safety net kept). Single SELECT per finding;
      // typical contract has 1-10 findings so the cost is bounded.
      const normalized = rawCategory.toLowerCase().replace(/\s+/g, ' ').trim();
      const candidate = RISK_CATEGORY_ALIASES[normalized] ?? rawCategory;
      const match = await this.riskCategoryRepository.findOne({
        where: { name: ILike(candidate), is_active: true },
      });
      if (match) {
        aiCategory = match.name; // store the canonical taxonomy name
      } else {
        aiCategory = 'Uncategorized';
        categoryWasUnrecognized = true;
      }
    }

    // ── Resolve defaults via B.1 resolver ─────────────────────────────
    // 5-min cache on (orgId, category, jurisdiction) keeps repeated
    // calls within the same job cheap.
    const resolved = await this.riskResolver.resolveDefaults({
      organizationId: orgId,
      riskCategory: aiCategory,
      // jurisdictionVariant intentionally omitted — A.3 platform-default
      // seeds with jurisdiction variants are not in yet. Once they land,
      // pass the contract's jurisdiction here.
    });

    // ── Determine final L, I and source attribution (Decision 8) ──────
    let likelihood: number;
    let impact: number;
    let likelihoodSource: RiskSourceType;
    let impactSource: RiskSourceType;

    if (
      Number.isInteger(aiRisk.likelihood) &&
      Number.isInteger(aiRisk.impact) &&
      aiRisk.likelihood >= 1 &&
      aiRisk.likelihood <= 5 &&
      aiRisk.impact >= 1 &&
      aiRisk.impact <= 5
    ) {
      // AI returned valid L,I — use them; attribution comes from the
      // methodology the resolver chose for this category.
      likelihood = aiRisk.likelihood;
      impact = aiRisk.impact;
      likelihoodSource = resolved.likelihood_source;
      impactSource = resolved.impact_source;
    } else {
      // Fall back to severity mapping; source = FALLBACK because the
      // AI did not use the methodology to produce L,I.
      const mapped = mapSeverityToLikelihoodImpact(aiRisk.severity);
      likelihood = mapped.l;
      impact = mapped.i;
      likelihoodSource = RiskSourceType.FALLBACK;
      impactSource = RiskSourceType.FALLBACK;
    }

    // ── Derive legacy risk_level from L×I (Decision 10) ───────────────
    const score = likelihood * impact;
    const riskLevel = mapScoreToRiskLevel(score);

    // ── If category was unknown, audit-log it (Decision 9) ────────────
    // Fires only when the AI returned a NON-EMPTY value that didn't
    // match the active taxonomy. AI omitting the field is not audited
    // — there is nothing to record.
    if (categoryWasUnrecognized && rawCategory) {
      await this.recordUnknownCategory(orgId, contractId, rawCategory);
    }

    // ── Resolve the clause link (Bug-2 fix) ──────────────────────────
    // The AI echoes back the clause's `clauses.id`, but `contract_clause_id`
    // FKs to `contract_clauses(id)` — a `clauses.id` there violates the FK
    // (0 clause ids are valid junction ids). Map clauses.id -> the
    // contract_clauses junction id for THIS contract. Null when the AI echoed
    // an id we can't resolve — the row still saves, unlinked, never an FK crash.
    // lint-exempt: wall-protected (finalizeReview walls contractId); clauses.id->cc.id FK map
    const junction = await this.contractClauseRepository.findOne({
      where: { contract_id: contractId, clause_id: aiRisk.clause_id },
    });
    const contractClauseId = junction?.id ?? null;

    // ── Build and save. Going through .save() ensures the
    //    @BeforeInsert hook on RiskAnalysis fires and sets risk_score.
    const row = this.riskAnalysisRepository.create({
      contract_id: contractId,
      contract_clause_id: contractClauseId,
      risk_category: aiCategory,
      risk_level: riskLevel,
      likelihood,
      impact,
      likelihood_source: likelihoodSource,
      impact_source: impactSource,
      platform_default_ref_id: resolved.platform_default_ref_id ?? null,
      description: aiRisk.description,
      recommendation: aiRisk.suggestion ?? null,
      status: 'OPEN',
    });
    await this.riskAnalysisRepository.save(row); // lint-exempt: S2f-deferred (metering-entangled, walled)
    return true;
  }

  /**
   * Audit-log an AI-returned category that doesn't match the active
   * risk_categories taxonomy. Mirror of B.2's recordMalformed pattern:
   * wrapped in try/catch so an audit-write failure does NOT propagate
   * — the writer's contract is "save the row", not "save the row AND
   * successfully log the category miss".
   */
  private async recordUnknownCategory(
    orgId: string,
    contractId: string,
    attemptedCategory: string,
  ): Promise<void> {
    try {
      await this.auditLogRepository.insert({
        user_id: undefined,
        organization_id: orgId,
        action: 'AI_RETURNED_UNKNOWN_RISK_CATEGORY',
        entity_type: 'contract',
        entity_id: contractId,
        new_values: { attempted_category: attemptedCategory } as any,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record AI_RETURNED_UNKNOWN_RISK_CATEGORY audit for ` +
          `contract=${contractId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Convert a file_url to a local file path.
   */
  private getLocalFilePath(fileUrl: string): string {
    // fileUrl format: http://localhost:3000/uploads/contracts/uuid.ext
    // Extract the relative path after /uploads/
    const uploadsIndex = fileUrl.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
      return '.' + fileUrl.substring(uploadsIndex);
    }
    return fileUrl;
  }

  // ─── Metering reconcile helpers (Phase 7.18 Part 3) ──────────────────
  //
  // Mirror the compliance Part 2 helper shape verbatim. All three
  // inspect TransitionResult and emit OBSERVABLE log signals on
  // {applied:false} so an Ops search by `metering.upload_extraction.*`
  // surfaces every applied:false occurrence across the lifecycle.
  //
  // The signal names align with the four canonical compliance signals
  // (CLAUDE.md "Phase 7.18 Part 2 — Compliance metering consumer"
  // section, table of four ops-search log signal names):
  //   - metering.upload_extraction.committed_after_release
  //   - metering.upload_extraction.released_after_terminal
  //   - metering.upload_extraction.commit_error
  //   - metering.upload_extraction.release_error

  /**
   * Called when a sync failure happens BETWEEN reserve() and the doc
   * row's save() — the local `reservation_id` is the only carrier (no
   * DB row to update). Used by uploadAndProcess + reprocess.
   *
   * Wraps release in try/catch. Re-throws of the inner error are owned
   * by the caller (we just log + signal); the original error remains
   * the one that gets surfaced to the HTTP layer.
   */
  private async releaseReservationInFlight(
    reservationId: string,
    originalErr: Error,
  ): Promise<void> {
    try {
      const result = await this.metering.release(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `[metering] release after synchronous in-flight upload failure was a no-op ` +
            `(reservation=${reservationId}, status=${result.status}) — peer ` +
            `(sweeper / double-release) won the race. ` +
            `metering.upload_extraction.released_after_terminal`,
        );
      }
    } catch (releaseErr) {
      this.logger.error(
        `[metering] release threw during in-flight upload failure path ` +
          `(reservation=${reservationId}, original=${originalErr.message}): ` +
          `${(releaseErr as Error).message}. ` +
          `metering.upload_extraction.release_error`,
      );
    }
  }

  /**
   * Called from any TERMINAL FAILURE path:
   *   - pollAndAdvance async-job-failed terminal (line ~284 in this file)
   *   - pollAndAdvance HUMAN_REVIEW_RECOMMENDED parked terminal (line ~320)
   *   - startTextExtraction sync-dispatch catch (line ~229)
   *   - startClauseExtraction sync-dispatch catch (line ~559)
   *
   * No-op when `doc.reservation_id` is NULL — either it's a pre-metering
   * doc (legacy) or the reserve never ran (cannot happen on the wired
   * paths, but defense-in-depth so accidentally-NULL rows don't crash
   * the failure path).
   *
   * {applied:false} on failure release means a peer (the sweeper or a
   * second-poll release) already released first — log explicitly; don't
   * swallow.
   */
  private async releaseReservationOnFailure(
    doc: DocumentUpload,
  ): Promise<void> {
    if (!doc.reservation_id) return;
    try {
      const result = await this.metering.release(doc.reservation_id);
      if (!result.applied) {
        this.logger.warn(
          `[metering] release on terminal upload failure was a no-op ` +
            `(doc=${doc.id}, reservation=${doc.reservation_id}, ` +
            `status=${result.status}) — peer (sweeper / double-release) ` +
            `won the race. metering.upload_extraction.released_after_terminal`,
        );
      } else if (result.status !== MeterLedgerStatus.RELEASED) {
        // Defensive — release() only ever sets RELEASED. If we see
        // anything else, surface it loudly.
        this.logger.error(
          `[metering] release returned applied:true but unexpected status ` +
            `(doc=${doc.id}, reservation=${doc.reservation_id}, ` +
            `status=${result.status}). metering.upload_extraction.release_unexpected_status`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] release threw on terminal upload failure ` +
          `(doc=${doc.id}, reservation=${doc.reservation_id}): ` +
          `${(err as Error).message}. metering.upload_extraction.release_error`,
      );
    }
  }

  /**
   * Called from advanceDocumentState's CLAUSES_EXTRACTED terminal-success
   * branch after writeClausesInTx has persisted the clauses.
   *
   * Success commit doesn't change `consumed` (capacity was taken at
   * reserve). The only state change is the ledger row flipping
   * reserved → committed.
   *
   * {applied:false} on success means the reservation was already
   * released, almost always by the engine sweeper because the run
   * outlived RESERVATION_TTL_SECONDS (the swept-then-uncharged hazard).
   * The upload SUCCEEDED but was NOT charged. Emit
   * `metering.upload_extraction.committed_after_release` so Ops can see
   * TTL < end-to-end duration on representative load.
   */
  private async commitReservationOnSuccess(
    doc: DocumentUpload,
  ): Promise<void> {
    if (!doc.reservation_id) return;
    try {
      const result = await this.metering.commit(doc.reservation_id);
      if (!result.applied) {
        this.logger.warn(
          `[metering] commit on terminal upload success was a no-op ` +
            `(doc=${doc.id}, reservation=${doc.reservation_id}, ` +
            `status=${result.status}) — upload succeeded but is recorded ` +
            `as ${result.status}; capacity was reclaimed (sweeper or peer ` +
            `release). metering.upload_extraction.committed_after_release`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] commit threw on terminal upload success ` +
          `(doc=${doc.id}, reservation=${doc.reservation_id}): ` +
          `${(err as Error).message}. metering.upload_extraction.commit_error`,
      );
    }
  }

  // ─── Metering reconcile helpers — finalize_review (Phase 7.18) ───────
  //
  // SAME shape as the upload_extraction helpers above, but keyed on a bare
  // reservation_id threaded in-memory through pollAndSaveRisks (NO doc
  // carrier row — the finalize burst writes many per-clause risk_analyses
  // rows, none of which is a natural single carrier; see finalizeReview's
  // carrier-divergence note). All three inspect TransitionResult and emit
  // OBSERVABLE log signals on {applied:false}, named `metering.finalize_review.*`
  // so an Ops search surfaces every applied:false occurrence:
  //   - metering.finalize_review.committed_after_release
  //   - metering.finalize_review.released_after_terminal
  //   - metering.finalize_review.commit_error
  //   - metering.finalize_review.release_error
  //
  // Each no-ops on a missing reservation_id (legacy / direct-test callers
  // of pollAndSaveRisks that don't thread one).

  /**
   * SYNCHRONOUS in-flight failure (clause load / risk dispatch threw BEFORE
   * the poller took ownership). The local reservation_id is the only
   * carrier — release in-request. The original error is re-thrown by the
   * caller; we only log + signal.
   */
  private async releaseFinalizeReservationInFlight(
    reservationId: string | null | undefined,
    originalErr: Error,
  ): Promise<void> {
    if (!reservationId) return;
    try {
      const result = await this.metering.release(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `[metering] release after synchronous in-flight finalize failure ` +
            `was a no-op (reservation=${reservationId}, status=${result.status}) ` +
            `— peer (sweeper / double-release) won the race. ` +
            `metering.finalize_review.released_after_terminal`,
        );
      }
    } catch (releaseErr) {
      this.logger.error(
        `[metering] release threw during in-flight finalize failure path ` +
          `(reservation=${reservationId}, original=${originalErr.message}): ` +
          `${(releaseErr as Error).message}. metering.finalize_review.release_error`,
      );
    }
  }

  /**
   * TERMINAL FAILURE of the finalize burst — risk job failed (~the failed
   * branch) or the poller timed out (~the timeout tail). Refund the
   * reservation. {applied:false} means a peer (the sweeper, almost always
   * because the run outlived RESERVATION_TTL_SECONDS) released first.
   */
  private async releaseFinalizeReservationOnFailure(
    reservationId: string | null | undefined,
    contractId: string,
    reason: string,
  ): Promise<void> {
    if (!reservationId) return;
    try {
      const result = await this.metering.release(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `[metering] release on terminal finalize failure was a no-op ` +
            `(contract=${contractId}, reservation=${reservationId}, ` +
            `status=${result.status}, reason="${reason}") — peer (sweeper / ` +
            `double-release) won the race. ` +
            `metering.finalize_review.released_after_terminal`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] release threw on terminal finalize failure ` +
          `(contract=${contractId}, reservation=${reservationId}, ` +
          `reason="${reason}"): ${(err as Error).message}. ` +
          `metering.finalize_review.release_error`,
      );
    }
  }

  /**
   * TERMINAL SUCCESS of the finalize burst — the AI risk job completed.
   * Commit the ONE finalize_review charge. No balance change (capacity was
   * taken at reserve). {applied:false} means the reservation was already
   * released, almost always by the sweeper because the run outlived
   * RESERVATION_TTL_SECONDS (the swept-then-uncharged hazard) — the
   * finalize SUCCEEDED but was NOT charged. Emit
   * `metering.finalize_review.committed_after_release` so Ops can see
   * TTL < end-to-end finalize duration on representative load.
   */
  private async commitFinalizeReservationOnSuccess(
    reservationId: string | null | undefined,
    contractId: string,
  ): Promise<void> {
    if (!reservationId) return;
    try {
      const result = await this.metering.commit(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `[metering] commit on terminal finalize success was a no-op ` +
            `(contract=${contractId}, reservation=${reservationId}, ` +
            `status=${result.status}) — finalize succeeded but is recorded ` +
            `as ${result.status}; capacity was reclaimed (sweeper or peer ` +
            `release). metering.finalize_review.committed_after_release`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[metering] commit threw on terminal finalize success ` +
          `(contract=${contractId}, reservation=${reservationId}): ` +
          `${(err as Error).message}. metering.finalize_review.commit_error`,
      );
    }
  }
}
