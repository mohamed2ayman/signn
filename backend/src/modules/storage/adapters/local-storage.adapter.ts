import { Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  IStorageAdapter,
  StorageResult,
} from '../interfaces/storage-adapter.interface';

/**
 * Local-filesystem storage adapter.
 *
 * Files are written to `<uploadDir>/<folder>/<filename>` and served via the
 * Express static middleware at `<baseUrl>/uploads/<folder>/<filename>`.
 * This is the default adapter (STORAGE_DRIVER=local or unset).
 */
export class LocalStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);

  constructor(
    private readonly uploadDir: string,
    private readonly baseUrl: string,
  ) {
    this.ensureDirsExist();
  }

  // ─── Directory bootstrap ─────────────────────────────────────────────────

  private ensureDirsExist(): void {
    const dirs = [
      'documents',
      'knowledge-assets',
      'contracts',
      'policies',
      'temp',
      'compliance-reports',
      'gdpr-exports',
    ];
    for (const dir of dirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  // ─── Security helper ─────────────────────────────────────────────────────

  /**
   * Ensure a resolved path is contained within the upload directory.
   * Prevents path-traversal attacks on read/delete operations.
   */
  private assertContained(filePath: string): void {
    const base = path.resolve(this.uploadDir) + path.sep;
    if (!path.resolve(filePath).startsWith(base)) {
      throw new BadRequestException('Invalid file path');
    }
  }

  // ─── URL ↔ local-path helpers ────────────────────────────────────────────

  private urlToLocalPath(fileUrl: string): string {
    // http://localhost:3000/uploads/contracts/uuid.pdf → <uploadDir>/contracts/uuid.pdf
    const relativePath = fileUrl.replace(`${this.baseUrl}/uploads/`, '');
    return path.join(this.uploadDir, relativePath);
  }

  // ─── IStorageAdapter implementation ─────────────────────────────────────

  async upload(
    buffer: Buffer,
    folder: string,
    filename: string,
    mimeType: string,
  ): Promise<StorageResult> {
    const filePath = path.join(this.uploadDir, folder, filename);
    this.assertContained(filePath);
    await fs.promises.writeFile(filePath, buffer);
    this.logger.log(`Uploaded locally: ${filePath} (${buffer.length} bytes)`);
    return {
      file_url: `${this.baseUrl}/uploads/${folder}/${filename}`,
      file_name: filename,
      file_size: buffer.length,
      mime_type: mimeType,
    };
  }

  async delete(fileUrl: string): Promise<void> {
    try {
      const filePath = this.urlToLocalPath(fileUrl);
      this.assertContained(filePath);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`Deleted: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete file: ${(error as Error).message}`);
    }
  }

  async getBuffer(fileUrl: string): Promise<Buffer> {
    const filePath = this.urlToLocalPath(fileUrl);
    this.assertContained(filePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.promises.readFile(filePath);
  }

  getLocalPathOrNull(fileUrl: string): string | null {
    try {
      const filePath = this.urlToLocalPath(fileUrl);
      this.assertContained(filePath);
      return filePath;
    } catch {
      return null;
    }
  }

  async getDownloadUrl(fileUrl: string, _expiresInSeconds?: number): Promise<string> {
    // Local files are served directly — the stored URL is the download URL.
    // The TTL parameter is intentionally ignored.
    return fileUrl;
  }
}
