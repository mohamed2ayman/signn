import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
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
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AiService } from '../ai/ai.service';
import { RiskMethodologyResolverService } from '../risk-analysis/services/risk-methodology-resolver.service';
import { RiskSourceType } from '../risk-analysis/enums/risk-source-type.enum';
import {
  mapScoreToRiskLevel,
  mapSeverityToLikelihoodImpact,
} from '../risk-analysis/utils/severity-mapping';
// Tenant-isolation Tier 1 — service-level wall on uploadAndProcess +
// reprocess + finalizeReview. Same `findInOrg` shape as PR #45.
import { ContractAccessService } from '../contracts/services/contract-access.service';
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

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    @InjectRepository(DocumentUpload)
    private readonly documentUploadRepository: Repository<DocumentUpload>,
    @InjectRepository(Clause)
    private readonly clauseRepository: Repository<Clause>,
    @InjectRepository(ContractClause)
    private readonly contractClauseRepository: Repository<ContractClause>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(RiskAnalysis)
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
    },
  ): Promise<DocumentUpload> {
    // Tenant-isolation Tier 1 — replace the bare `findOne({ id: contractId })`
    // with `contractAccess.findInOrg(contractId, orgId)`. Cross-tenant
    // probe → 404 (NOT 403 — no existence leak). In-org behaviour
    // unchanged: contract existence is still verified, the org-mismatch
    // case is the new defense.
    await this.contractAccess.findInOrg(contractId, orgId);

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
      meterKey: MeterKey.UPLOAD_EXTRACTION,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: userId,
      metadata: { route: 'POST /contracts/:contractId/documents' },
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

      saved = await this.documentUploadRepository.save(doc);
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
      await this.documentUploadRepository.save(doc);
    } catch (error) {
      this.logger.error(
        `[startTextExtraction] Text extraction failed for document ${doc.id}: ${error.message}`,
        error.stack,
      );
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = `Text extraction failed to start: ${error.message}`;
      await this.documentUploadRepository.save(doc);
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
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Tenant wall — walk doc → contract → org. Throws 404 if the doc's
    // contract belongs to another org. Mirrors the reprocess pattern
    // shipped in Tier 1.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);

    if (
      doc.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED ||
      doc.processing_status === DocumentProcessingStatus.FAILED ||
      doc.processing_status === DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED
    ) {
      return doc;
    }

    if (!doc.processing_job_id) {
      return doc;
    }

    const jobStatus = await this.aiService.getJobStatus(doc.processing_job_id);

    if (jobStatus.status === 'failed') {
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = jobStatus.error || 'Processing failed';
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc);
      // Phase 7.18 Part 3 — ASYNC TERMINAL FAILURE. The AI job reported
      // failed (text-extraction OR clause-extraction; both flow through
      // here). Refund the reservation. Inspect TransitionResult inside
      // the helper; emit observable signal on {applied:false}.
      await this.releaseReservationOnFailure(doc);
      return doc;
    }

    if (jobStatus.status !== 'completed') {
      // Still processing
      return doc;
    }

    // Job completed — advance pipeline
    if (doc.processing_status === DocumentProcessingStatus.EXTRACTING_TEXT) {
      // Text extraction complete
      const textResult = jobStatus.result?.result || jobStatus.result;
      const rawText = textResult?.text || '';
      doc.page_count = textResult?.page_count || 0;

      // Phase 7.25 — persist quality flags from the OCR pipeline.
      const qualityFlags: string[] = Array.isArray(textResult?.quality_flags)
        ? (textResult.quality_flags as string[])
        : [];
      doc.quality_flags = qualityFlags.length > 0 ? qualityFlags : null;

      // Trim cover pages / TOC before saving so both the DB and
      // clause extraction receive the cleaned text.
      doc.extracted_text = this.trimCoverPages(rawText, doc.document_label);

      // Phase 7.25 — if scan quality flags were detected, park the document
      // in HUMAN_REVIEW_RECOMMENDED instead of advancing to clause extraction.
      // The partial extracted_text is still saved (may be useful for the user
      // to preview what was captured).
      if (qualityFlags.length > 0) {
        this.logger.warn(
          `[pollAndAdvance] Poor scan quality detected for document ${doc.id}: [${qualityFlags.join(', ')}]. ` +
          `Setting status to HUMAN_REVIEW_RECOMMENDED.`,
        );
        doc.processing_status = DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED;
        doc.processing_job_id = null;
        await this.documentUploadRepository.save(doc);
        // Phase 7.18 Part 3 — PARKED-TERMINAL state. No clauses were
        // extracted from this upload; the metered unit ("extraction") did
        // not produce its deliverable. Refund the reservation. If the
        // user clicks "Reprocess" / "Continue anyway", that path takes a
        // FRESH reservation (see reprocess() below). NOT a double-charge
        // — it IS a new intent (new user click; new dispatch).
        await this.releaseReservationOnFailure(doc);
        return doc;
      }

      doc.processing_status = DocumentProcessingStatus.TEXT_EXTRACTED;
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc);

      // Extract party names if the text contains contract party markers
      const extractedText = doc.extracted_text || '';
      const partyMarker = /(?:بين\s*كل\s*من|تم\s*الاتفاق\s*بين\s*كل\s*من|كل\s*من\s*:)/;
      if (partyMarker.test(extractedText)) {
        // Only extract if the contract doesn't already have parties
        const currentContract = await this.contractRepository.findOne({
          where: { id: doc.contract_id },
        });
        if (!currentContract?.party_first_name && !currentContract?.party_second_name) {
          try {
            const parties = this.extractParties(extractedText);
            if (parties.firstParty || parties.secondParty) {
              await this.contractRepository.update(
                { id: doc.contract_id },
                {
                  party_first_name: parties.firstParty,
                  party_second_name: parties.secondParty,
                },
              );
              this.logger.log(
                `Extracted parties for contract ${doc.contract_id}: "${parties.firstParty}" / "${parties.secondParty}"`,
              );
            }
          } catch (err) {
            this.logger.warn(`Party extraction failed for contract ${doc.contract_id}: ${err?.message}`);
          }
        }
      }

      // Immediately trigger clause extraction
      await this.startClauseExtraction(doc);
    } else if (
      doc.processing_status === DocumentProcessingStatus.EXTRACTING_CLAUSES
    ) {
      // Clause extraction complete
      const clauseResult = jobStatus.result?.result || jobStatus.result;
      const extractedClauses = clauseResult?.clauses || [];

      // Create clause records in DB
      await this.createClausesFromExtraction(
        extractedClauses,
        doc.contract_id,
        doc.id,
        doc.uploaded_by,
        doc.organization_id,
      );

      doc.processing_status = DocumentProcessingStatus.CLAUSES_EXTRACTED;
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc);

      // Phase 7.18 Part 3 — ASYNC TERMINAL SUCCESS. Clauses are now in
      // the DB; the metered unit ("extraction") produced its
      // deliverable. Commit the reservation. Inspect TransitionResult
      // inside the helper; emit observable signal on {applied:false}
      // (the swept-then-uncharged hazard — TTL < end-to-end duration).
      await this.commitReservationOnSuccess(doc);
    }

    return doc;
  }

  /**
   * Trim cover pages, table of contents, and other preamble from the
   * extracted text so that only substantive contract content is sent to
   * clause extraction.  The trimming strategy depends on the document label.
   */
  private trimCoverPages(text: string, documentLabel?: string | null): string {
    if (!text) return text;

    // Detect conditions/specifications documents by label so we avoid matching
    // agreement phrases (e.g. "تم الاتفاق") that can appear mid-body in those docs.
    const label = (documentLabel ?? '').toLowerCase();
    const isConditionsDoc =
      /condition|شروط|general|particular|spec|مواصفات/.test(label);

    if (isConditionsDoc) {
      // For conditions docs: try numbered-article patterns FIRST.
      // This prevents "تم الاتفاق" buried inside an article from truncating the text.
      const conditionsPatterns = [
        /مادة\s*[\(\s]?[١-٩\d]/,   // مادة (1) / مادة ١ / مادة 1
        /المادة\s*[\(\s]?[١-٩\d]/, // المادة (1) / المادة 1
        /البند\s*[\(\s]?[١-٩\d]/,  // البند (1) / البند 1
        /Article\s*1\b/i,
        /Clause\s*1\b/i,
        /^1[-–.]/m,
      ];
      for (const pattern of conditionsPatterns) {
        const match = text.match(pattern);
        if (match?.index !== undefined) {
          return text.substring(match.index);
        }
      }
      // No numbered article found — return as-is
      return text;
    }

    // For agreement / general documents: try agreement opening phrases first
    const agreementPatterns = [
      /إنه في يوم/,
      /تم الاتفاق بين كل من/,
      /تم الاتفاق/,
    ];
    for (const pattern of agreementPatterns) {
      const match = text.match(pattern);
      if (match?.index !== undefined) {
        return text.substring(match.index);
      }
    }

    // Fallback: conditions-style numbered patterns
    const conditionsPatterns = [
      /مادة\s*[\(\s]?[١-٩\d]/,
      /المادة\s*[\(\s]?[١-٩\d]/,
      /البند\s*[\(\s]?[١-٩\d]/,
      /Article\s*1\b/i,
      /Clause\s*1\b/i,
      /^1[-–.]/m,
    ];
    for (const pattern of conditionsPatterns) {
      const match = text.match(pattern);
      if (match?.index !== undefined) {
        return text.substring(match.index);
      }
    }

    return text;
  }

  /**
   * Extract party names from Arabic contract agreement text using regex.
   * Looks for the pattern after "كل من:" to find First Party and Second Party.
   */
  /** Shared stop-word pattern for party name extraction. */
  private static readonly PARTY_STOP_WORDS =
    /(?:ويمثلها|ومقرها|ومقره|مقرها|ويشار|طرف أول|الطرف الأول|طرف ثان|الطرف الثاني|–\s*طرف|هاتف|تليفون|ص\.?\s*ب|والكائن|الكائن|يقع مقرها|الواقع|بالعنوان|سرايات|ميدان|في\s+\d)/;

  /** Trim a party name that is too long — cut at the first address-like word after "في". */
  private trimPartyName(name: string): string {
    const words = name.split(/\s+/);
    if (words.length <= 15) return name;

    // Look for "في" followed by a number or location word
    const addressCut = name.match(/\s+في\s+(?:\d|ميدان|شارع|منطقة|مدينة|حي|سرايات|طريق)/);
    if (addressCut?.index !== undefined) {
      return name.substring(0, addressCut.index).trim();
    }

    // Fallback: keep first 15 words
    return words.slice(0, 15).join(' ');
  }

  private extractParties(
    text: string,
  ): { firstParty: string | null; secondParty: string | null } {
    const result = { firstParty: null as string | null, secondParty: null as string | null };
    if (!text) return result;

    // Look for contract party context: "بين كل من" or "كل من:"
    const kolMinMatch = text.match(/(?:بين\s*كل\s*من|تم\s*الاتفاق\s*بين\s*كل\s*من|كل\s*من\s*:)/);
    if (!kolMinMatch || kolMinMatch.index === undefined) return result;

    const afterKolMin = text.substring(kolMinMatch.index + kolMinMatch[0].length);

    // First Party: text until stop words
    const firstMatch = afterKolMin.match(DocumentProcessingService.PARTY_STOP_WORDS);
    if (firstMatch?.index !== undefined) {
      const raw = afterKolMin.substring(0, firstMatch.index).trim();
      const cleaned = raw.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 400) {
        result.firstParty = this.trimPartyName(cleaned);
      }
    }

    // Second Party: after "(طرف أول)" or "الطرف الأول" find next party name
    const afterFirstParty = text.match(
      /(?:طرف أول\s*\)?|الطرف الأول\s*\)?)\s*(?:و\s*(?:بين\s*)?|[\s\-–:]*\d*[\s\-–:]*)/,
    );
    if (afterFirstParty?.index !== undefined) {
      const secondStart = afterFirstParty.index + afterFirstParty[0].length;
      const remaining = text.substring(secondStart);

      const secondMatch = remaining.match(DocumentProcessingService.PARTY_STOP_WORDS);
      if (secondMatch?.index !== undefined) {
        const raw = remaining.substring(0, secondMatch.index).trim();
        const cleaned = raw.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
        if (cleaned.length > 2 && cleaned.length < 400) {
          result.secondParty = this.trimPartyName(cleaned);
        }
      }
    }

    return result;
  }

  /**
   * Trigger clause extraction for a document with extracted text.
   *
   * Phase 7.18 Part 3 — second SYNC-DISPATCH terminal failure path. Same
   * shape as startTextExtraction: FAILED is terminal, refund the meter.
   */
  private async startClauseExtraction(doc: DocumentUpload): Promise<void> {
    try {
      const contract = await this.contractRepository.findOne({
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
      await this.documentUploadRepository.save(doc);
    } catch (error) {
      this.logger.error(
        `[startClauseExtraction] Clause extraction failed for document ${doc.id}: ${error.message}`,
        error.stack,
      );
      doc.processing_status = DocumentProcessingStatus.FAILED;
      doc.error_message = `Clause extraction failed to start: ${error.message}`;
      await this.documentUploadRepository.save(doc);
      // SYNC-DISPATCH FAILURE TERMINAL — refund the reservation.
      await this.releaseReservationOnFailure(doc);
    }
  }

  /**
   * Create Clause and ContractClause records from extracted data.
   */
  private async createClausesFromExtraction(
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
  ): Promise<void> {
    for (let i = 0; i < extractedClauses.length; i++) {
      const ec = extractedClauses[i];

      // Create the clause record
      const clause = this.clauseRepository.create({
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

      const savedClause = await this.clauseRepository.save(clause);

      // Create the contract-clause junction
      const contractClause = this.contractClauseRepository.create({
        contract_id: contractId,
        clause_id: savedClause.id,
        section_number: ec.section_number || null,
        order_index: i,
      });

      await this.contractClauseRepository.save(contractClause);
    }

    this.logger.log(
      `Created ${extractedClauses.length} clauses for contract ${contractId} from document ${documentId}`,
    );
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
    doc.extracted_text = text;
    return this.documentUploadRepository.save(doc);
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
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Tenant wall — walk doc → contract → org. Throws 404 if the doc's
    // contract belongs to another org.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);

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
        await this.contractClauseRepository.delete({ clause_id: In(clauseIds) });

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
      await this.documentUploadRepository.save(doc);
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
    return this.contractClauseRepository
      .createQueryBuilder('cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .leftJoinAndSelect('clause.source_document', 'source_doc')
      .where('cc.contract_id = :contractId', { contractId })
      .andWhere('clause.source = :source', { source: ClauseSource.AI_EXTRACTED })
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
      const contractClauses = await this.contractClauseRepository
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

    await this.riskAnalysisRepository.save(risk);
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
    const MAX_POLLS = 60;
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
      // Validate against the active taxonomy. Single SELECT per finding;
      // typical contract has 1-10 findings so the cost is bounded.
      const match = await this.riskCategoryRepository.findOne({
        where: { name: rawCategory, is_active: true },
      });
      if (match) {
        aiCategory = rawCategory;
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

    // ── Build and save. Going through .save() ensures the
    //    @BeforeInsert hook on RiskAnalysis fires and sets risk_score.
    const row = this.riskAnalysisRepository.create({
      contract_id: contractId,
      contract_clause_id: aiRisk.clause_id,
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
    await this.riskAnalysisRepository.save(row);
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
   * Called from pollAndAdvance's CLAUSES_EXTRACTED terminal-success
   * branch after createClausesFromExtraction has persisted the clauses.
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
