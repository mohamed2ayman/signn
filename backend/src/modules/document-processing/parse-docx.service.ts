import {
  Injectable,
  Logger,
  RequestTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { AiService } from '../ai/ai.service';

export interface ParseDocxClause {
  id: string;
  clause_ref: string;
  text: string;
  title: string;
  clause_type: string | null;
  section_number: string | null;
  confidence: number;
  paragraph_start: number;
  paragraph_end: number;
  char_start: number;
  char_end: number;
}

export interface ParseDocxResult {
  full_text: string;
  clauses: ParseDocxClause[];
}

interface ParseInput {
  file: Express.Multer.File | null;
  text: string | null;
  contract_type?: string;
  org_id: string;
  user_id: string;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 60_000;

@Injectable()
export class ParseDocxService {
  private readonly logger = new Logger(ParseDocxService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly aiService: AiService,
  ) {}

  async parse(input: ParseInput): Promise<ParseDocxResult> {
    const fullText = await this.resolveFullText(input);

    const clauseJob = await this.aiService.triggerExtractClauses({
      contract_id: 'parse-docx-' + Date.now().toString(36),
      full_text: fullText,
      contract_type: input.contract_type,
      org_id: input.org_id,
    });

    const result = await this.pollUntilComplete(clauseJob.job_id);
    const extracted = (result?.result?.result?.clauses ??
      result?.result?.clauses ??
      []) as Array<{
      title: string;
      content: string;
      clause_type: string;
      section_number?: string;
      confidence: number;
    }>;

    const clauses = this.augmentWithBoundaries(extracted, fullText);

    return { full_text: fullText, clauses };
  }

  private async resolveFullText(input: ParseInput): Promise<string> {
    if (input.text) return input.text;
    if (!input.file) {
      throw new InternalServerErrorException(
        'parse-from-docx: neither file nor text was provided after validation',
      );
    }

    const uploaded = await this.storageService.uploadFile(
      input.file as unknown as UploadedFile,
      'parse-docx',
    );
    const localPath = this.urlToLocalPath(uploaded.file_url);

    const extractJob = await this.aiService.triggerExtractText({
      file_path: localPath,
      mime_type: input.file.mimetype || 'application/octet-stream',
    });
    const extractResult = await this.pollUntilComplete(extractJob.job_id);
    const text =
      extractResult?.result?.result?.text ??
      extractResult?.result?.text ??
      '';
    if (!text) {
      throw new InternalServerErrorException(
        'parse-from-docx: text extraction returned empty result',
      );
    }
    return text;
  }

  private async pollUntilComplete(
    jobId: string,
  ): Promise<Record<string, any>> {
    const start = Date.now();
    while (Date.now() - start < MAX_POLL_MS) {
      const status = await this.aiService.getJobStatus(jobId);
      if (status.status === 'completed') return status;
      if (status.status === 'failed') {
        throw new InternalServerErrorException(
          `AI job ${jobId} failed: ${status.error ?? 'unknown error'}`,
        );
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new RequestTimeoutException(
      `AI job ${jobId} did not complete within ${MAX_POLL_MS / 1000}s`,
    );
  }

  /**
   * Generate stable boundaries for each clause by string-matching its content
   * back into the full text. We walk forward from the previous clause's end
   * so duplicate phrases earlier in the document don't capture later clauses.
   */
  private augmentWithBoundaries(
    extracted: Array<{
      title: string;
      content: string;
      clause_type: string;
      section_number?: string;
      confidence: number;
    }>,
    fullText: string,
  ): ParseDocxClause[] {
    const paragraphOffsets = this.computeParagraphOffsets(fullText);
    const result: ParseDocxClause[] = [];
    let cursor = 0;

    extracted.forEach((ec, i) => {
      const charStart = this.findClauseStart(fullText, ec.content, cursor);
      const charEnd =
        charStart >= 0 ? charStart + ec.content.length : -1;
      cursor = charEnd > cursor ? charEnd : cursor;

      const paragraphStart =
        charStart >= 0
          ? this.charToParagraph(charStart, paragraphOffsets)
          : -1;
      const paragraphEnd =
        charEnd >= 0
          ? this.charToParagraph(charEnd, paragraphOffsets)
          : -1;

      const clauseRef = ec.section_number?.trim()
        ? ec.section_number.trim()
        : paragraphStart >= 0
          ? `P${paragraphStart}`
          : `C${i}`;

      result.push({
        id: `clause-${i}`,
        clause_ref: clauseRef,
        text: ec.content,
        title: ec.title,
        clause_type: ec.clause_type ?? null,
        section_number: ec.section_number ?? null,
        confidence: ec.confidence,
        paragraph_start: paragraphStart,
        paragraph_end: paragraphEnd,
        char_start: charStart,
        char_end: charEnd,
      });
    });

    return result;
  }

  /**
   * Locate `needle` in `haystack` starting at or after `from`. Falls back to
   * a fuzzy match using the first ~80 chars if the exact match is not found
   * (the AI may have minor whitespace edits).
   */
  private findClauseStart(
    haystack: string,
    needle: string,
    from: number,
  ): number {
    if (!needle) return -1;
    const exact = haystack.indexOf(needle, from);
    if (exact >= 0) return exact;

    const prefix = needle.slice(0, 80).trim();
    if (!prefix) return -1;
    const fuzzy = haystack.indexOf(prefix, from);
    return fuzzy;
  }

  private computeParagraphOffsets(text: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
  }

  private charToParagraph(charIndex: number, offsets: number[]): number {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (offsets[mid] <= charIndex) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private urlToLocalPath(fileUrl: string): string {
    const idx = fileUrl.indexOf('/uploads/');
    return idx >= 0 ? '.' + fileUrl.substring(idx) : fileUrl;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
