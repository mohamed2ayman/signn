/**
 * Storage adapter and StorageService unit tests.
 *
 * Covers:
 *  1. LocalStorageAdapter.getLocalPathOrNull — well-formed URL → local path
 *  2. LocalStorageAdapter.getLocalPathOrNull — malformed URL → null
 *  3. LocalStorageAdapter.getLocalPathOrNull — path traversal attempt → null
 *  4. S3StorageAdapter.getLocalPathOrNull — always null
 *  5. StorageService.getLocalPathOrNull — delegates to adapter (local)
 *  6. StorageService.getLocalPathOrNull — delegates to adapter (S3 → null)
 */

import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';

import { LocalStorageAdapter } from '../adapters/local-storage.adapter';
import { S3StorageAdapter } from '../adapters/s3-storage.adapter';
import { StorageService } from '../storage.service';
import {
  STORAGE_ADAPTER,
  IStorageAdapter,
} from '../interfaces/storage-adapter.interface';

// ─── LocalStorageAdapter ───────────────────────────────────────────────────────

describe('LocalStorageAdapter.getLocalPathOrNull', () => {
  const UPLOAD_DIR = '/app/uploads';
  const BASE_URL = 'http://localhost:3000';
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    // Patch fs.existsSync / fs.mkdirSync so the constructor's ensureDirsExist()
    // doesn't fail in the Jest / Node environment (no real /app/uploads).
    jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
    jest.spyOn(require('fs'), 'mkdirSync').mockImplementation(() => undefined);

    adapter = new LocalStorageAdapter(UPLOAD_DIR, BASE_URL);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the correct absolute local path for a well-formed file_url', () => {
    const fileUrl = `${BASE_URL}/uploads/legal-documents/abc123.pdf`;
    const result = adapter.getLocalPathOrNull(fileUrl);

    expect(result).toBe(
      path.join(UPLOAD_DIR, 'legal-documents', 'abc123.pdf'),
    );
  });

  it('returns the correct local path for a nested folder', () => {
    const fileUrl = `${BASE_URL}/uploads/compliance-reports/uuid-report.pdf`;
    const result = adapter.getLocalPathOrNull(fileUrl);

    expect(result).toBe(
      path.join(UPLOAD_DIR, 'compliance-reports', 'uuid-report.pdf'),
    );
  });

  it('returns null for a URL that does not match the expected base pattern', () => {
    // URL from a different origin — should not resolve to a local path.
    // The adapter's prefix guard rejects any URL that does not start with
    // `${baseUrl}/uploads/` before attempting path resolution.
    const result = adapter.getLocalPathOrNull('https://evil.example.com/file.pdf');

    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = adapter.getLocalPathOrNull('');
    expect(result).toBeNull();
  });

  it('returns null for a path-traversal attempt in the URL', () => {
    // Attempt to escape uploadDir via ../../etc
    const maliciousUrl = `${BASE_URL}/uploads/../../../etc/passwd`;
    const result = adapter.getLocalPathOrNull(maliciousUrl);
    expect(result).toBeNull();
  });
});

// ─── S3StorageAdapter ──────────────────────────────────────────────────────────

describe('S3StorageAdapter.getLocalPathOrNull', () => {
  let adapter: S3StorageAdapter;

  beforeEach(() => {
    // S3Client is injected — pass a minimal stub; we never call send() in this test.
    adapter = new S3StorageAdapter(
      {} as any, // S3Client stub
      'my-test-bucket',
      'us-east-1',
    );
  });

  it('returns null for any file_url (S3 has no local path)', () => {
    expect(
      adapter.getLocalPathOrNull(
        'https://my-test-bucket.s3.us-east-1.amazonaws.com/legal-documents/abc.pdf',
      ),
    ).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(adapter.getLocalPathOrNull('')).toBeNull();
  });

  it('returns null even for a local-looking URL (adapter is S3, not local)', () => {
    expect(
      adapter.getLocalPathOrNull('http://localhost:3000/uploads/file.pdf'),
    ).toBeNull();
  });
});

// ─── StorageService.getLocalPathOrNull ────────────────────────────────────────

describe('StorageService.getLocalPathOrNull', () => {
  const FAKE_LOCAL_PATH = '/app/uploads/legal-documents/test.pdf';

  let service: StorageService;
  let mockAdapter: jest.Mocked<IStorageAdapter>;

  beforeEach(async () => {
    mockAdapter = {
      upload: jest.fn(),
      delete: jest.fn(),
      getBuffer: jest.fn(),
      getLocalPathOrNull: jest.fn(),
      getDownloadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: STORAGE_ADAPTER, useValue: mockAdapter },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('delegates to the adapter and returns the local path when adapter returns one', () => {
    const fileUrl = 'http://localhost:3000/uploads/legal-documents/test.pdf';
    mockAdapter.getLocalPathOrNull.mockReturnValueOnce(FAKE_LOCAL_PATH);

    const result = service.getLocalPathOrNull(fileUrl);

    expect(mockAdapter.getLocalPathOrNull).toHaveBeenCalledWith(fileUrl);
    expect(result).toBe(FAKE_LOCAL_PATH);
  });

  it('returns null when the adapter returns null (e.g. S3 adapter)', () => {
    const fileUrl = 'https://bucket.s3.amazonaws.com/file.pdf';
    mockAdapter.getLocalPathOrNull.mockReturnValueOnce(null);

    const result = service.getLocalPathOrNull(fileUrl);

    expect(mockAdapter.getLocalPathOrNull).toHaveBeenCalledWith(fileUrl);
    expect(result).toBeNull();
  });

  it('is synchronous — does not return a Promise', () => {
    mockAdapter.getLocalPathOrNull.mockReturnValueOnce(FAKE_LOCAL_PATH);
    const result = service.getLocalPathOrNull('http://localhost:3000/uploads/file.pdf');
    // If it returned a Promise, this would be an object, not a string
    expect(typeof result).toBe('string');
  });
});
