import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
  ) {}

  /**
   * Upload a document and start the processing pipeline.
   */
  async uploadAndProcess(
    contractId: string,
    file: UploadedFile,
    userId: string,
    orgId: string,
    options?: { document_label?: string; document_priority?: number },
  ): Promise<DocumentUpload> {
    // Tenant-isolation Tier 1 — replace the bare `findOne({ id: contractId })`
    // with `contractAccess.findInOrg(contractId, orgId)`. Cross-tenant
    // probe → 404 (NOT 403 — no existence leak). In-org behaviour
    // unchanged: contract existence is still verified, the org-mismatch
    // case is the new defense.
    await this.contractAccess.findInOrg(contractId, orgId);

    // Upload file to storage
    const uploadResult = await this.storageService.uploadFile(file, 'contracts');

    // Multer delivers originalname as Latin-1 encoded bytes.
    // Decode to UTF-8 so non-ASCII characters (e.g. Arabic) display correctly.
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf-8');

    // Create document record
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
    });

    const saved = await this.documentUploadRepository.save(doc);
    this.logger.log(`Document uploaded: ${saved.id} for contract ${contractId}`);

    // Start text extraction
    await this.startTextExtraction(saved);

    return saved;
  }

  /**
   * Trigger text extraction for a document.
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
    }
  }

  /**
   * Poll the current job and advance the pipeline if complete.
   */
  async pollAndAdvance(docId: string): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

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
   */
  async getDocuments(contractId: string): Promise<DocumentUpload[]> {
    return this.documentUploadRepository.find({
      where: { contract_id: contractId },
      order: { document_priority: 'ASC', created_at: 'ASC' },
    });
  }

  /**
   * Get a single document with status info.
   */
  async getDocumentStatus(docId: string): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return doc;
  }

  /**
   * Update the extracted text of a document (manual correction).
   */
  async updateExtractedText(
    docId: string,
    orgId: string,
    text: string,
  ): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId, organization_id: orgId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
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
   */
  async reprocess(docId: string, orgId: string): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Tenant wall — walk doc → contract → org. Throws 404 if the doc's
    // contract belongs to another org.
    await this.contractAccess.findInOrg(doc.contract_id, orgId);

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
    await this.documentUploadRepository.save(doc);

    await this.startTextExtraction(doc);
    return doc;
  }

  /**
   * Get clauses pending review for a contract.
   */
  async getClausesForReview(contractId: string) {
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
  ): Promise<{
    risk_job_id: string;
    obligations_job_id: string;
    conflict_job_id: string | null;
  }> {
    // Tenant wall — throws 404 on cross-tenant probe; AI dispatch never
    // fires under the attacker's org.
    await this.contractAccess.findInOrg(contractId, orgId);

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
    const clausesForAi = contractClauses.map((cc) => ({
      id: cc.clause.id,
      text: cc.clause.content,
      document_id: cc.clause.source_document?.id || null,
      document_label: cc.clause.source_document?.document_label || null,
      document_priority: cc.clause.source_document?.document_priority ?? 0,
    }));

    // Trigger risk analysis (with document priority for conflict detection)
    const riskResult = await this.aiService.triggerRiskAnalysis({
      contract_id: contractId,
      clauses: clausesForAi,
      org_id: orgId,
    });

    // Phase 7.17 — Prompt 1, A.1: poll the risk job in the background and
    // save per-clause risks. Before this hook, the risk_job_id was returned
    // to the caller but never consumed — per-clause risks were silently
    // dropped. Mirror of the pollAndSaveConflicts pattern below.
    this.pollAndSaveRisks(contractId, riskResult.job_id, orgId).catch((err) => {
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
        return;
      }

      if (jobStatus.status === 'completed') {
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
}
