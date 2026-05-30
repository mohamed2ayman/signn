import { Test } from '@nestjs/testing';
import { Request, Response } from 'express';
import { PortfolioExportDownloadController } from './portfolio-export-download.controller';
import { PortfolioExportTokenService } from '../services/portfolio-export-token.service';
import { StorageService } from '../../storage/storage.service';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — GET /portfolio-exports/download tests.
 *
 * Carry-forwards from earlier buckets, all asserted:
 *
 *   - HMAC-before-DB invariant: signature failures collapse to 401
 *     without leaking which check failed. Bucket 1's spec proves
 *     no DB call on HMAC fail; this spec proves the controller maps
 *     that result to the right HTTP code + audit row.
 *
 *   - HTTP outcome matrix (from the user's locked plan):
 *       200 valid           — file streamed
 *       401 bad signature   — invalid_signature reason
 *       401 malformed       — malformed reason
 *       410 expired         — expired reason
 *       410 not found       — not_found reason
 *       410 file cleaned    — verified OK but file gone (race)
 *
 *   - FK SET NULL scenario: user_id NULLed after token issued. Verify()'s
 *     DB filter WHERE user_id = payload.user_id no longer matches the
 *     row (NULL ≠ value) → returns not_found → controller maps to 410.
 *     This is the dedicated user-deleted-after-token-issued path.
 *
 *   - Cleanup-during-verification race + upload-then-file-deleted: token
 *     verifies, DB row valid, but storage.getBuffer throws. Controller
 *     MUST return clean 410 (not 500) with the not_found audit type +
 *     metadata.reason = 'file_missing_after_verify' for forensics.
 *
 *   - Audit log: every outcome writes a row with the correct event type
 *     so admin/security forensics can detect leaked-URL probes.
 */

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';

function makeRow(overrides: Partial<PortfolioExportJob> = {}): PortfolioExportJob {
  const row = new PortfolioExportJob();
  row.id = JOB_ID;
  row.user_id = USER_ID;
  row.org_id = ORG_ID;
  row.project_id = null;
  row.period = '90d';
  row.status = PortfolioExportStatus.COMPLETED;
  row.file_path = 'http://localhost:3000/uploads/portfolio-exports/x.pdf';
  row.email = 'user@example.com';
  row.error = null;
  row.expires_at = new Date(Date.now() + 30 * 60 * 1000);
  row.created_at = new Date();
  row.completed_at = new Date();
  row.file_deleted = false;
  return Object.assign(row, overrides);
}

interface FakeRes {
  statusCode: number;
  body?: string | Buffer;
  headers: Record<string, string>;
  status(code: number): FakeRes;
  send(body: string | Buffer): FakeRes;
  end(body?: string | Buffer): FakeRes;
  setHeader(name: string, value: string): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: string | Buffer) {
      this.body = body;
      return this;
    },
    end(body?: string | Buffer) {
      if (body !== undefined) this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function makeReq(): Request {
  return {
    ip: '203.0.113.5',
    headers: { 'user-agent': 'TestAgent/1.0' },
  } as any;
}

interface Mocks {
  verify: jest.Mock;
  getBuffer: jest.Mock;
  record: jest.Mock;
}

async function makeController(mocks: Partial<Mocks> = {}): Promise<{
  controller: PortfolioExportDownloadController;
  m: Mocks;
}> {
  const m: Mocks = {
    verify: mocks.verify ?? jest.fn().mockResolvedValue({ ok: true, job: makeRow() }),
    getBuffer: mocks.getBuffer ?? jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    record: mocks.record ?? jest.fn().mockResolvedValue(undefined),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [PortfolioExportDownloadController],
    providers: [
      { provide: PortfolioExportTokenService, useValue: { verify: m.verify } },
      { provide: StorageService, useValue: { getBuffer: m.getBuffer } },
      { provide: SecurityEventService, useValue: { record: m.record } },
    ],
  }).compile();
  return { controller: moduleRef.get(PortfolioExportDownloadController), m };
}

describe('PortfolioExportDownloadController (GET /portfolio-exports/download)', () => {
  describe('200 — valid token, file streams', () => {
    it('returns the PDF inline with the right content headers + writes a success audit row', async () => {
      const row = makeRow();
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes-for-real')),
      });
      const res = makeRes();

      await controller.download('valid.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/pdf');
      expect(res.headers['Content-Disposition']).toContain(`portfolio-export-${JOB_ID}.pdf`);
      expect(Buffer.isBuffer(res.body)).toBe(true);

      expect(m.record).toHaveBeenCalledTimes(1);
      const audit = m.record.mock.calls[0][0];
      expect(audit.type).toBe(SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_SUCCESS);
      expect(audit.actor_id).toBe(USER_ID);
      expect(audit.organization_id).toBe(ORG_ID);
      expect(audit.ip_address).toBe('203.0.113.5');
      expect(audit.entity_type).toBe('portfolio_export_job');
      expect(audit.entity_id).toBe(JOB_ID);
      expect(audit.metadata?.user_agent).toBe('TestAgent/1.0');
    });
  });

  describe('401 — signature failures (no info leak between malformed and tampered)', () => {
    it('returns 401 + invalid_signature audit on tampered/forged signature', async () => {
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'invalid_signature' }),
      });
      const res = makeRes();

      await controller.download('forged.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('Invalid download link.');
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_INVALID_SIGNATURE,
          actor_id: null,
          organization_id: null,
          ip_address: '203.0.113.5',
        }),
      );
    });

    it('returns 401 + malformed audit on malformed token (SAME 401 — no enumeration)', async () => {
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'malformed' }),
      });
      const res = makeRes();

      await controller.download('garbage', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('Invalid download link.');
      // Audit log captures the truth; HTTP body is identical to the
      // tampered-signature case so an attacker can't enumerate which
      // check failed.
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_MALFORMED,
        }),
      );
    });
  });

  describe('410 — gone (expired / not_found collapse to the same HTTP code)', () => {
    it('returns 410 + expired audit on payload-side expiry', async () => {
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'expired' }),
      });
      const res = makeRes();

      await controller.download('expired.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link has expired or is no longer available.');
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_EXPIRED,
        }),
      );
    });

    it('returns 410 + not_found audit when verify() finds no matching COMPLETED row', async () => {
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'not_found' }),
      });
      const res = makeRes();

      await controller.download('valid-but-orphan.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link has expired or is no longer available.');
      // HTTP body identical to the expired case — no enumeration.
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND,
        }),
      );
    });
  });

  describe('CARRY-FORWARD: FK SET NULL after token issued (user deleted)', () => {
    it('returns 410 not_found — the FK SET NULL property — when user_id NULLed after issuance', async () => {
      // The verify() chain queries:
      //   WHERE id = payload.job_id AND user_id = payload.user_id AND status = COMPLETED
      // After the user is deleted, FK SET NULL flips the row's user_id
      // to NULL. NULL = '<uuid>' is NULL (treated as FALSE in WHERE), so
      // findOne returns null → verify() returns { ok: false, reason: 'not_found' }.
      // From the controller's perspective this is the same code path as
      // an orphan token, so we test the controller's response.
      //
      // This test makes the carry-forward concrete: deleting the user
      // silently kills their in-flight export links.
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'not_found' }),
      });
      const res = makeRes();

      await controller.download('token-for-deleted-user.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link has expired or is no longer available.');
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND,
          ip_address: '203.0.113.5',
        }),
      );
    });
  });

  describe('CARRY-FORWARD: race between verify success and stream open', () => {
    it('returns 410 (NOT 500) when storage.getBuffer throws (cleanup-during-verification)', async () => {
      // Token verifies + DB row valid + expires_at not yet reached, but
      // between verify and stream open the cleanup cron deleted the
      // file. StorageService.getBuffer throws.
      //
      // Property under test: the controller must return a clean 410
      // (NOT a 500 / NOT an unhandled error). Audit log captures the
      // race via metadata.reason = 'file_missing_after_verify'.
      const row = makeRow();
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockRejectedValue(new Error('ENOENT')),
      });
      const res = makeRes();

      await controller.download('valid.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link is no longer available.');
      // The response status is NOT 500 — confirms the controller caught
      // the race.
      expect(res.statusCode).not.toBe(500);
    });

    it('writes a not_found audit row with metadata.reason = "file_missing_after_verify"', async () => {
      const row = makeRow();
      const { controller, m } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockRejectedValue(new Error('S3 GetObject 404')),
      });

      await controller.download('valid.token', makeReq(), makeRes() as unknown as Response);

      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND,
          actor_id: USER_ID,
          organization_id: ORG_ID,
          metadata: expect.objectContaining({
            reason: 'file_missing_after_verify',
          }),
        }),
      );
    });

    it('also handles upload-then-file-deleted-before-stream identically (same race shape)', async () => {
      // This is the second carry-forward scenario — semantically distinct
      // (file was uploaded but storage cleanup ran for an unrelated reason),
      // mechanically identical from the controller's perspective. One
      // handler covers both. Test it explicitly so the property is
      // documented.
      const row = makeRow();
      const { controller } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockRejectedValue(new Error('file removed by retention policy')),
      });
      const res = makeRes();

      await controller.download('valid.token', makeReq(), res as unknown as Response);

      expect(res.statusCode).toBe(410);
      expect(res.statusCode).not.toBe(500);
    });
  });

  describe('audit-record failure cannot break the download response (critical-path invariant)', () => {
    it('still streams the file with 200 when SecurityEventService.record throws on the success path', async () => {
      // The download controller wraps each audit.record call in safeAudit
      // (try/catch + logger.warn). Mirrors the docusign.service.ts
      // convention. The property under test: an audit-log hiccup must
      // NEVER turn a valid 200 download into a 500. A legitimate user
      // whose audit row fails to write still gets their PDF.
      const row = makeRow();
      const recordThrows = jest.fn().mockRejectedValue(new Error('audit_logs unreachable'));
      const { controller } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
        record: recordThrows,
      });
      const res = makeRes();
      const warnSpy = jest
        .spyOn((controller as any).logger, 'warn')
        .mockImplementation(() => undefined);

      // Must not throw out of the handler — that would propagate to
      // Nest's exception filter and 500 the user.
      await expect(
        controller.download('valid.token', makeReq(), res as unknown as Response),
      ).resolves.toBeUndefined();

      // The file streamed with 200 and the right headers, even though
      // the audit write threw.
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/pdf');
      expect(res.headers['Content-Disposition']).toContain(`portfolio-export-${JOB_ID}.pdf`);
      expect(Buffer.isBuffer(res.body)).toBe(true);

      // The audit failure was attempted (so we didn't silently skip it)
      // and was logged as a warning.
      expect(recordThrows).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('Failed to record audit event');

      warnSpy.mockRestore();
    });

    it('still returns 410 with the right body when audit throws on a failure outcome', async () => {
      // Symmetry: failure-outcome audit writes are wrapped too, so a
      // failure response can't be turned into a 500 either.
      const recordThrows = jest.fn().mockRejectedValue(new Error('audit_logs unreachable'));
      const { controller } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: false, reason: 'expired' }),
        record: recordThrows,
      });
      const res = makeRes();
      const warnSpy = jest
        .spyOn((controller as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        controller.download('expired.token', makeReq(), res as unknown as Response),
      ).resolves.toBeUndefined();

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link has expired or is no longer available.');
      expect(recordThrows).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    it('still returns 410 with the right body when audit throws on the verify→stream race outcome', async () => {
      const row = makeRow();
      const recordThrows = jest.fn().mockRejectedValue(new Error('audit_logs unreachable'));
      const { controller } = await makeController({
        verify: jest.fn().mockResolvedValue({ ok: true, job: row }),
        getBuffer: jest.fn().mockRejectedValue(new Error('ENOENT')),
        record: recordThrows,
      });
      const res = makeRes();
      const warnSpy = jest
        .spyOn((controller as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        controller.download('valid.token', makeReq(), res as unknown as Response),
      ).resolves.toBeUndefined();

      expect(res.statusCode).toBe(410);
      expect(res.body).toBe('This download link is no longer available.');
      // Two warns: the race log + the audit-failure log.
      expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      warnSpy.mockRestore();
    });
  });

});
