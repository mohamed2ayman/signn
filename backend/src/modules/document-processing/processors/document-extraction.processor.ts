import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bull';
import { In, Repository } from 'typeorm';

import {
  DocumentProcessingStatus,
  DocumentUpload,
} from '../../../database/entities';
import { DocumentProcessingService } from '../document-processing.service';

/**
 * Guest extraction completion — SERVER-SIDE driver processor.
 *
 * Runs in the NestJS backend process (where the `document-processing-jobs`
 * repeatable job is registered). Each 30s tick scans uploads that are mid-AI
 * (EXTRACTING_TEXT / EXTRACTING_CLAUSES WITH a live processing_job_id) and runs
 * the SAME race-safe advance the browser polls run — driving each to terminal
 * (CLAUSES_EXTRACTED / FAILED / HUMAN_REVIEW_RECOMMENDED) WITHOUT any browser.
 *
 * SYSTEM context — no principal, no per-caller access wall (the advance is
 * doc-derived, so it writes PROPOSED clauses for guest uploads and LIVE for
 * managing uploads, race-safe regardless of which driver wins). Terminal docs
 * are excluded from the scan, so the driver self-terminates per-doc and never
 * re-runs a completed advance. Mirrors MeteringCleanupProcessor.
 */
@Processor('document-processing-jobs')
export class DocumentExtractionProcessor {
  private readonly logger = new Logger(DocumentExtractionProcessor.name);

  private static readonly BATCH_SIZE = 100;

  constructor(
    @InjectRepository(DocumentUpload) // lint-exempt: system/no-orgId (processor)
    private readonly docRepo: Repository<DocumentUpload>,
    private readonly docProcessing: DocumentProcessingService,
  ) {}

  @Process({ name: 'advance-in-progress', concurrency: 1 })
  async handleAdvance(_job: Job<Record<string, never>>): Promise<void> {
    // ALL non-terminal in-progress states are scanned — including the
    // transient-but-durable UPLOADED / TEXT_EXTRACTED rows (null job_id). The
    // common rows (EXTRACTING_TEXT / EXTRACTING_CLAUSES with a live job) are
    // advanced; a row crash-stranded with no live job is caught by
    // advanceDocumentState's staleness backstop and FAILed once it ages out, so
    // NOTHING is left forever-stuck. Terminal states (CLAUSES_EXTRACTED /
    // FAILED / HUMAN_REVIEW_RECOMMENDED) are excluded → the driver
    // self-terminates per-doc.
    const candidates = await this.docRepo.find({ // lint-exempt: system/no-orgId (processor)
      where: {
        processing_status: In([
          DocumentProcessingStatus.UPLOADED,
          DocumentProcessingStatus.EXTRACTING_TEXT,
          DocumentProcessingStatus.TEXT_EXTRACTED,
          DocumentProcessingStatus.EXTRACTING_CLAUSES,
        ]),
      },
      select: ['id'],
      order: { created_at: 'ASC' },
      take: DocumentExtractionProcessor.BATCH_SIZE,
    });

    if (candidates.length === 0) {
      this.logger.debug('Extraction driver tick: no in-progress uploads');
      return;
    }

    let advanced = 0;
    let errors = 0;
    for (const row of candidates) {
      try {
        // advanceDocumentState is race-safe (atomic conditional transitions),
        // so this is safe even if a browser poll drives the SAME doc at the
        // same instant — exactly one writes clauses + commits. It self-no-ops
        // on transient rows still within the staleness window.
        await this.docProcessing.advanceInProgressAsSystem(row.id);
        advanced++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `Extraction driver: failed to advance document ${row.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Extraction driver tick: stepped ${advanced}/${candidates.length} in-progress uploads (errors: ${errors})`,
    );
  }
}
