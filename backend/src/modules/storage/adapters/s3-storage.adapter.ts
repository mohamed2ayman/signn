import { Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import {
  IStorageAdapter,
  StorageResult,
} from '../interfaces/storage-adapter.interface';

/**
 * AWS S3 storage adapter.
 *
 * Active when STORAGE_DRIVER=s3.  All file operations go through the AWS SDK.
 * getLocalPathOrNull() always returns null — callers that require a local path
 * (e.g. the AI text-extraction pipeline) must be updated before switching to
 * this adapter in production.
 *
 * File URL format stored in the database:
 *   https://<bucket>.s3.<region>.amazonaws.com/<folder>/<filename>
 *
 * Download URLs are presigned GET URLs generated on demand via getDownloadUrl().
 */
export class S3StorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly region: string,
  ) {}

  // ─── URL ↔ S3-key helpers ─────────────────────────────────────────────────

  private keyToUrl(folder: string, filename: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${folder}/${filename}`;
  }

  private urlToKey(fileUrl: string): string {
    try {
      // https://bucket.s3.region.amazonaws.com/folder/file.pdf → folder/file.pdf
      const url = new URL(fileUrl);
      return url.pathname.slice(1); // strip leading /
    } catch {
      // Fallback: treat the value as a raw S3 key
      return fileUrl;
    }
  }

  // ─── IStorageAdapter implementation ──────────────────────────────────────

  async upload(
    buffer: Buffer,
    folder: string,
    filename: string,
    mimeType: string,
  ): Promise<StorageResult> {
    const key = `${folder}/${filename}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    this.logger.log(`Uploaded to S3: s3://${this.bucket}/${key} (${buffer.length} bytes)`);
    return {
      file_url: this.keyToUrl(folder, filename),
      file_name: filename,
      file_size: buffer.length,
      mime_type: mimeType,
    };
  }

  async delete(fileUrl: string): Promise<void> {
    try {
      const key = this.urlToKey(fileUrl);
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      this.logger.log(`Deleted from S3: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete S3 object: ${(error as Error).message}`);
    }
  }

  async getBuffer(fileUrl: string): Promise<Buffer> {
    const key = this.urlToKey(fileUrl);
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`S3 object not found: ${key}`);
    }
    const stream = response.Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  getLocalPathOrNull(_fileUrl: string): string | null {
    // S3 objects have no local filesystem path.
    return null;
  }

  async getDownloadUrl(
    fileUrl: string,
    expiresInSeconds: number = 3600,
  ): Promise<string> {
    const key = this.urlToKey(fileUrl);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }
}
