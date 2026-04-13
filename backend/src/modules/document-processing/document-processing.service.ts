import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DocumentUpload,
  DocumentProcessingStatus,
  Clause,
  ClauseSource,
  ClauseReviewStatus,
  ContractClause,
  Contract,
  RiskAnalysis,
  RiskLevel,
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AiService } from '../ai/ai.service';

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
    private readonly storageService: StorageService,
    private readonly aiService: AiService,
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
    // Verify contract exists
    const contract = await this.contractRepository.findOne({
      where: { id: contractId },
    });
    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

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
      doc.processing_status === DocumentProcessingStatus.FAILED
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

      // Trim cover pages / TOC before saving so both the DB and
      // clause extraction receive the cleaned text.
      doc.extracted_text = this.trimCoverPages(rawText, doc.document_label);

      doc.processing_status = DocumentProcessingStatus.TEXT_EXTRACTED;
      doc.processing_job_id = null;
      await this.documentUploadRepository.save(doc);

      // Extract party names from agreement-type documents
      const docLabel = (doc.document_label || '').toLowerCase();
      if (
        docLabel.includes('agreement') ||
        docLabel.includes('اتفاقية') ||
        docLabel.includes('عقد')
      ) {
        try {
          const parties = this.extractParties(doc.extracted_text || '');
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
    if (!text || !documentLabel) return text;

    const label = documentLabel.toLowerCase();

    // --- Contract Agreement documents ---
    if (
      label.includes('agreement') ||
      label.includes('اتفاقية') ||
      label.includes('عقد')
    ) {
      const patterns = [
        /إنه في يوم/,
        /تم الاتفاق بين كل من/,
        /تم الاتفاق/,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.index !== undefined) {
          return text.substring(match.index);
        }
      }
    }

    // --- General Conditions / Particular Conditions documents ---
    if (
      label.includes('condition') ||
      label.includes('شروط') ||
      label.includes('المادة') ||
      label.includes('البند')
    ) {
      const patterns = [
        /المادة\s*1\b/,
        /البند\s*1\b/,
        /Article\s*1\b/i,
        /Clause\s*1\b/i,
        /^1[-–.]/m,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.index !== undefined) {
          return text.substring(match.index);
        }
      }
    }

    return text;
  }

  /**
   * Extract party names from Arabic contract agreement text using regex.
   * Looks for the pattern after "كل من:" to find First Party and Second Party.
   */
  private extractParties(
    text: string,
  ): { firstParty: string | null; secondParty: string | null } {
    const result = { firstParty: null as string | null, secondParty: null as string | null };
    if (!text) return result;

    // Look for text after "كل من:" or "كل من :"
    const kolMinMatch = text.match(/كل\s*من\s*[:\s]/);
    if (!kolMinMatch || kolMinMatch.index === undefined) return result;

    const afterKolMin = text.substring(kolMinMatch.index + kolMinMatch[0].length);

    // First Party: text until stop words
    const firstPartyStops = /(?:ويمثلها|ومقرها|ويشار|طرف أول|الطرف الأول|–\s*طرف|هاتف|تليفون|ص\.?\s*ب)/;
    const firstMatch = afterKolMin.match(firstPartyStops);
    if (firstMatch?.index !== undefined) {
      const raw = afterKolMin.substring(0, firstMatch.index).trim();
      // Clean up: remove leading/trailing dashes, numbers, etc.
      const cleaned = raw.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 400) {
        result.firstParty = cleaned;
      }
    }

    // Second Party: after "(طرف أول)" or "الطرف الأول" find next party name
    const afterFirstParty = text.match(
      /(?:طرف أول\s*\)?|الطرف الأول\s*\)?)\s*(?:و\s*(?:بين\s*)?|[\s\-–:]*\d*[\s\-–:]*)/,
    );
    if (afterFirstParty?.index !== undefined) {
      const secondStart = afterFirstParty.index + afterFirstParty[0].length;
      const remaining = text.substring(secondStart);

      const secondPartyStops = /(?:ويمثلها|ومقرها|ويشار|طرف ثان|الطرف الثاني|–\s*طرف|هاتف|تليفون|ص\.?\s*ب)/;
      const secondMatch = remaining.match(secondPartyStops);
      if (secondMatch?.index !== undefined) {
        const raw = remaining.substring(0, secondMatch.index).trim();
        const cleaned = raw.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
        if (cleaned.length > 2 && cleaned.length < 400) {
          result.secondParty = cleaned;
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
   * Reprocess a failed document.
   */
  async reprocess(docId: string): Promise<DocumentUpload> {
    const doc = await this.documentUploadRepository.findOne({
      where: { id: docId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    doc.processing_status = DocumentProcessingStatus.UPLOADED;
    doc.error_message = null;
    doc.processing_job_id = null;
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
   */
  async finalizeReview(
    contractId: string,
    orgId: string,
  ): Promise<{
    risk_job_id: string;
    obligations_job_id: string;
    conflict_job_id: string | null;
  }> {
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
