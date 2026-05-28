/**
 * Storage abstraction layer.
 *
 * STORAGE_ADAPTER is the DI injection token. Use it anywhere you need the
 * underlying adapter directly; most application code should inject the
 * higher-level StorageService instead.
 */

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface StorageResult {
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

export interface IStorageAdapter {
  /**
   * Persist a buffer under `folder/filename` and return metadata including
   * the canonical URL (`file_url`) that callers and the database should store.
   */
  upload(
    buffer: Buffer,
    folder: string,
    filename: string,
    mimeType: string,
  ): Promise<StorageResult>;

  /** Delete by the `file_url` returned from `upload()`. Best-effort — never throws. */
  delete(fileUrl: string): Promise<void>;

  /** Retrieve raw bytes for a file identified by its `file_url`. */
  getBuffer(fileUrl: string): Promise<Buffer>;

  /**
   * Return the local filesystem path for the file, or **null** when the adapter
   * does not use local disk (e.g. the S3 adapter). Callers that require a local
   * path (e.g. the AI pipeline via shared Docker volume) must check for null.
   */
  getLocalPathOrNull(fileUrl: string): string | null;

  /**
   * Return a URL suitable for downloading the file.
   * - Local adapter: returns `file_url` as-is (served by Express static).
   * - S3 adapter: returns a presigned GET URL valid for `expiresInSeconds`.
   */
  getDownloadUrl(fileUrl: string, expiresInSeconds?: number): Promise<string>;
}
