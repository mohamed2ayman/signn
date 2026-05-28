import { Injectable, Inject, Logger } from '@nestjs/common';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  STORAGE_ADAPTER,
  IStorageAdapter,
} from './interfaces/storage-adapter.interface';

// Re-export StorageResult so the existing import shape
//   import { StorageService } from '../storage/storage.service'
// is unchanged for every consumer that references the return type.
export type { StorageResult } from './interfaces/storage-adapter.interface';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_ADAPTER)
    private readonly adapter: IStorageAdapter,
  ) {}

  // ─── Public API (all consumers use these methods) ─────────────────────────

  /**
   * Upload a multer file (from a controller @UploadedFile() parameter).
   * Generates a UUID-based storage key so the original name never appears in
   * the stored path.  Returns the decoded original name as `file_name`.
   */
  async uploadFile(
    file: UploadedFile,
    folder: string = 'documents',
  ): Promise<import('./interfaces/storage-adapter.interface').StorageResult> {
    // Multer delivers originalname as Latin-1 encoded bytes.
    // Decode to UTF-8 so non-ASCII characters (e.g. Arabic) display correctly.
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const ext = path.extname(decodedName);
    const fileName = `${uuidv4()}${ext}`;

    const result = await this.adapter.upload(file.buffer, folder, fileName, file.mimetype);
    this.logger.log(`File uploaded: ${result.file_url} (${file.size} bytes)`);

    // Return the human-readable original name, not the UUID-based stored name.
    return { ...result, file_name: decodedName };
  }

  /**
   * Upload a raw buffer directly.
   * Used when the file is produced in-process (e.g. PDF renderer, GDPR ZIP)
   * rather than received from a multipart form upload.
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    filename: string,
    mimeType: string,
  ): Promise<import('./interfaces/storage-adapter.interface').StorageResult> {
    const result = await this.adapter.upload(buffer, folder, filename, mimeType);
    this.logger.log(`Buffer uploaded: ${result.file_url} (${buffer.length} bytes)`);
    return result;
  }

  /** Delete a file by its stored `file_url`. Best-effort — never throws. */
  async deleteFile(fileUrl: string): Promise<void> {
    return this.adapter.delete(fileUrl);
  }

  /**
   * Retrieve raw bytes for a stored file.
   * Works for both local and S3 adapters.
   */
  async getBuffer(fileUrl: string): Promise<Buffer> {
    return this.adapter.getBuffer(fileUrl);
  }

  /**
   * Return the local filesystem path for a stored file, or **null** if the
   * active adapter does not use local disk (e.g. S3).
   *
   * Callers that absolutely require a local path (currently: the AI
   * text-extraction pipeline via shared Docker volume) must check for null
   * and handle accordingly before switching to the S3 adapter.
   */
  getLocalPathOrNull(fileUrl: string): string | null {
    return this.adapter.getLocalPathOrNull(fileUrl);
  }

  /**
   * Return a URL suitable for downloading the file.
   * - Local adapter: returns the `file_url` as-is (served by Express static).
   * - S3 adapter: returns a presigned GET URL valid for `expiresInSeconds`.
   */
  async getDownloadUrl(fileUrl: string, expiresInSeconds?: number): Promise<string> {
    return this.adapter.getDownloadUrl(fileUrl, expiresInSeconds);
  }

  // ─── Deprecated wrappers (kept for backward compatibility) ───────────────

  /**
   * @deprecated Use getBuffer() instead.
   */
  async getFileBuffer(fileUrl: string): Promise<Buffer> {
    return this.getBuffer(fileUrl);
  }

  /**
   * @deprecated Use getLocalPathOrNull() instead.
   * Throws when the active adapter returns null (non-local storage).
   */
  getFilePath(fileUrl: string): string {
    const localPath = this.getLocalPathOrNull(fileUrl);
    if (localPath === null) {
      throw new Error(
        'getFilePath() is not supported with non-local storage. Use getBuffer() instead.',
      );
    }
    return localPath;
  }

  /** Lightweight text extraction for .txt files. Non-txt returns empty string. */
  async extractTextFromFile(fileUrl: string): Promise<string> {
    const buffer = await this.getBuffer(fileUrl);
    const ext = path.extname(fileUrl).toLowerCase();
    if (ext === '.txt') {
      return buffer.toString('utf-8');
    }
    // For PDF/DOCX, the AI backend handles OCR
    return '';
  }
}
