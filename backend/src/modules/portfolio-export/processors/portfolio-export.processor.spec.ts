import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import { PortfolioExportProcessor } from './portfolio-export.processor';
import { PortfolioExportTokenService } from '../services/portfolio-export-token.service';
import { PortfolioExportRendererService } from '../services/portfolio-export-renderer.service';
import { PortfolioAnalyticsService } from '../../portfolio-analytics/portfolio-analytics.service';
import { StorageService } from '../../storage/storage.service';
import { EmailService } from '../../notifications/email.service';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c Bucket 2 — processor unit tests.
 *
 * Mandated coverage (plan review):
 *   - happy path (PENDING → RUNNING → COMPLETED, file uploaded, token
 *     issued, success email sent)
 *   - 3 failure modes — each must leave status=FAILED and issue NO
 *     usable token:
 *       (1) aggregation throws    → no upload, failure email sent
 *       (2) storage upload fails  → no token used, no completion row,
 *                                   failure email sent
 *       (3) email send fails      → file CLEANED via deleteFile,
 *                                   no completion row, failure email
 *                                   attempted (best-effort)
 *
 * "Issue NO token" is the persistent-state assertion: the DB row never
 * reaches status=COMPLETED with file_path + expires_at set. The token
 * bytes themselves may be generated in-memory en route to the email
 * URL, but verify() rejects them as `not_found` because the DB filter
 * requires status=COMPLETED.
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
  row.status = PortfolioExportStatus.PENDING;
  row.file_path = null;
  row.email = 'user@example.com';
  row.error = null;
  row.expires_at = null;
  row.created_at = new Date();
  row.completed_at = null;
  row.file_deleted = false;
  return Object.assign(row, overrides);
}

function makeJob(): Job<{ job_id: string }> {
  return { data: { job_id: JOB_ID } } as any;
}

interface Mocks {
  jobRepoFindOne: jest.Mock;
  jobRepoUpdate: jest.Mock;
  analyticsGet: jest.Mock;
  rendererRender: jest.Mock;
  storageUpload: jest.Mock;
  storageDelete: jest.Mock;
  tokenIssue: jest.Mock;
  emailSend: jest.Mock;
}

async function makeProcessor(mocks: Partial<Mocks> = {}): Promise<{
  processor: PortfolioExportProcessor;
  m: Mocks;
}> {
  const row = makeRow();
  const m: Mocks = {
    jobRepoFindOne: mocks.jobRepoFindOne ?? jest.fn().mockResolvedValue(row),
    jobRepoUpdate: mocks.jobRepoUpdate ?? jest.fn().mockResolvedValue({ affected: 1 }),
    analyticsGet: mocks.analyticsGet ?? jest.fn().mockResolvedValue({ kpis: {} }),
    rendererRender: mocks.rendererRender ?? jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    storageUpload:
      mocks.storageUpload ??
      jest.fn().mockResolvedValue({
        file_url: 'http://localhost:3000/uploads/portfolio-exports/x.pdf',
        file_name: 'portfolio-export-x.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
      }),
    storageDelete: mocks.storageDelete ?? jest.fn().mockResolvedValue(undefined),
    tokenIssue: mocks.tokenIssue ?? jest.fn().mockReturnValue('payloadB64.sigB64'),
    emailSend: mocks.emailSend ?? jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PortfolioExportProcessor,
      {
        provide: getRepositoryToken(PortfolioExportJob),
        useValue: { findOne: m.jobRepoFindOne, update: m.jobRepoUpdate },
      },
      {
        provide: PortfolioAnalyticsService,
        useValue: { getPortfolioAnalytics: m.analyticsGet },
      },
      {
        provide: PortfolioExportRendererService,
        useValue: { render: m.rendererRender },
      },
      {
        provide: StorageService,
        useValue: {
          uploadBuffer: m.storageUpload,
          deleteFile: m.storageDelete,
        },
      },
      {
        provide: PortfolioExportTokenService,
        useValue: { issue: m.tokenIssue },
      },
      {
        provide: EmailService,
        useValue: { sendGenericEmail: m.emailSend },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'BASE_URL' ? 'http://localhost:3000' : undefined,
          ),
        },
      },
    ],
  }).compile();

  return { processor: moduleRef.get(PortfolioExportProcessor), m };
}

/**
 * Helper: count update() calls that set a specific status, ignoring
 * which exact field set they carry. Useful for asserting "completion
 * persisted" vs "FAILED persisted" without coupling to field order.
 */
function countUpdatesWithStatus(
  jobRepoUpdate: jest.Mock,
  status: PortfolioExportStatus,
): number {
  return jobRepoUpdate.mock.calls.filter((call) => {
    const patch = call[1];
    return patch && patch.status === status;
  }).length;
}

describe('PortfolioExportProcessor', () => {
  describe('happy path', () => {
    it('PENDING → RUNNING → COMPLETED, file uploaded, token issued, success email sent', async () => {
      const { processor, m } = await makeProcessor();
      await processor.handleRenderExport(makeJob());

      // Aggregation called with row fields
      expect(m.analyticsGet).toHaveBeenCalledWith(ORG_ID, '90d', undefined);
      // Renderer received the aggregation response + a context
      expect(m.rendererRender).toHaveBeenCalledTimes(1);
      // Upload happened
      expect(m.storageUpload).toHaveBeenCalledWith(
        expect.any(Buffer),
        'portfolio-exports',
        expect.stringMatching(/^portfolio-export-.*\.pdf$/),
        'application/pdf',
      );
      // Token issued for (jobId, userId, expiresAt) — Date arg sniffed loosely
      expect(m.tokenIssue).toHaveBeenCalledWith(JOB_ID, USER_ID, expect.any(Date));
      // Success email sent with the download URL containing the token
      expect(m.emailSend).toHaveBeenCalledTimes(1);
      const [emailTo, emailSubject, emailHtml] = m.emailSend.mock.calls[0];
      expect(emailTo).toBe('user@example.com');
      expect(emailSubject).toContain('ready');
      expect(emailHtml).toContain('payloadB64.sigB64'); // token embedded in URL
      expect(emailHtml).toContain('/api/v1/portfolio-exports/download?token=');

      // jobRepo.update called twice — RUNNING then COMPLETED
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.RUNNING)).toBe(1);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.COMPLETED)).toBe(1);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(0);

      // The COMPLETED update carries file_path + expires_at + completed_at
      const completedCall = m.jobRepoUpdate.mock.calls.find(
        (c) => c[1].status === PortfolioExportStatus.COMPLETED,
      );
      expect(completedCall![1]).toMatchObject({
        status: PortfolioExportStatus.COMPLETED,
        file_path: 'http://localhost:3000/uploads/portfolio-exports/x.pdf',
        expires_at: expect.any(Date),
        completed_at: expect.any(Date),
      });

      // No cleanup (happy path means file should NOT be deleted)
      expect(m.storageDelete).not.toHaveBeenCalled();
    });
  });

  describe('failure mode 1: aggregation throws', () => {
    it('marks FAILED, NO upload, NO token used (no COMPLETED row), failure email sent', async () => {
      const analyticsGet = jest.fn().mockRejectedValue(new Error('DB connection lost'));
      const { processor, m } = await makeProcessor({ analyticsGet });

      await processor.handleRenderExport(makeJob());

      // No upload happened
      expect(m.storageUpload).not.toHaveBeenCalled();
      // No cleanup needed (nothing was uploaded)
      expect(m.storageDelete).not.toHaveBeenCalled();
      // No completion row written
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.COMPLETED)).toBe(0);
      // FAILED row written WITH error message
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(1);
      const failedCall = m.jobRepoUpdate.mock.calls.find(
        (c) => c[1].status === PortfolioExportStatus.FAILED,
      );
      expect(failedCall![1]).toMatchObject({
        status: PortfolioExportStatus.FAILED,
        error: 'DB connection lost',
      });
      // Failure email sent
      expect(m.emailSend).toHaveBeenCalledTimes(1);
      expect(m.emailSend.mock.calls[0][1]).toContain('failed');
    });
  });

  describe('failure mode 2: storage upload fails', () => {
    it('marks FAILED, no completion row, no cleanup attempted (file never uploaded), failure email sent', async () => {
      const storageUpload = jest.fn().mockRejectedValue(new Error('S3 unreachable'));
      const { processor, m } = await makeProcessor({ storageUpload });

      await processor.handleRenderExport(makeJob());

      // Token was NOT issued — upload failed before token issuance
      expect(m.tokenIssue).not.toHaveBeenCalled();
      // No success email
      expect(m.emailSend.mock.calls.length).toBe(1); // exactly one — the failure email
      expect(m.emailSend.mock.calls[0][1]).toContain('failed');
      // No cleanup — upload never succeeded, so uploadedFileUrl stays null
      expect(m.storageDelete).not.toHaveBeenCalled();
      // FAILED with error
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.COMPLETED)).toBe(0);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(1);
      const failedCall = m.jobRepoUpdate.mock.calls.find(
        (c) => c[1].status === PortfolioExportStatus.FAILED,
      );
      expect(failedCall![1].error).toBe('S3 unreachable');
    });
  });

  describe('failure mode 3: email send fails', () => {
    it('marks FAILED, CLEANS UP the orphan file, failure email attempted (best-effort)', async () => {
      const emailSend = jest
        .fn()
        // First call (success email) throws
        .mockRejectedValueOnce(new Error('SMTP timeout'))
        // Second call (failure email) succeeds
        .mockResolvedValueOnce(undefined);
      const { processor, m } = await makeProcessor({ emailSend });

      await processor.handleRenderExport(makeJob());

      // Upload happened (succeeded), THEN cleanup ran in the catch
      expect(m.storageUpload).toHaveBeenCalledTimes(1);
      expect(m.storageDelete).toHaveBeenCalledTimes(1);
      expect(m.storageDelete).toHaveBeenCalledWith(
        'http://localhost:3000/uploads/portfolio-exports/x.pdf',
      );

      // Token WAS issued in-memory (it was needed to build the email URL),
      // but no COMPLETED row persists — verify() will return not_found.
      expect(m.tokenIssue).toHaveBeenCalledTimes(1);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.COMPLETED)).toBe(0);

      // FAILED persisted with the SMTP error
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(1);
      const failedCall = m.jobRepoUpdate.mock.calls.find(
        (c) => c[1].status === PortfolioExportStatus.FAILED,
      );
      expect(failedCall![1].error).toBe('SMTP timeout');

      // emailSend called twice total: success attempt (threw) + failure email
      expect(emailSend).toHaveBeenCalledTimes(2);
      expect(emailSend.mock.calls[0][1]).toContain('ready'); // success template subject
      expect(emailSend.mock.calls[1][1]).toContain('failed'); // failure template subject
    });

    it('logs but does not throw if the failure email ALSO fails (worst-case cascade)', async () => {
      const emailSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('SMTP timeout'))
        .mockRejectedValueOnce(new Error('SMTP still down'));
      const { processor, m } = await makeProcessor({ emailSend });

      // Must not throw — Bull would re-attempt the job otherwise.
      await expect(processor.handleRenderExport(makeJob())).resolves.toBeUndefined();

      // Cleanup still happened, FAILED still persisted.
      expect(m.storageDelete).toHaveBeenCalledTimes(1);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(1);
    });
  });

  describe('edge: row missing', () => {
    it('returns silently if the job row is not found (logs error, no state mutated)', async () => {
      const jobRepoFindOne = jest.fn().mockResolvedValue(null);
      const { processor, m } = await makeProcessor({ jobRepoFindOne });

      await expect(processor.handleRenderExport(makeJob())).resolves.toBeUndefined();

      expect(m.jobRepoUpdate).not.toHaveBeenCalled();
      expect(m.analyticsGet).not.toHaveBeenCalled();
      expect(m.storageUpload).not.toHaveBeenCalled();
      expect(m.emailSend).not.toHaveBeenCalled();
    });
  });

  describe('edge: user deleted between request and processor (user_id NULL on row)', () => {
    it('fails fast — FAILED with "user deleted" error, no upload, failure email sent', async () => {
      const rowWithoutUser = makeRow({ user_id: null });
      const jobRepoFindOne = jest.fn().mockResolvedValue(rowWithoutUser);
      const { processor, m } = await makeProcessor({ jobRepoFindOne });

      await processor.handleRenderExport(makeJob());

      // RUNNING update DOES happen (precedes the user_id null check),
      // but COMPLETED never does.
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.COMPLETED)).toBe(0);
      expect(countUpdatesWithStatus(m.jobRepoUpdate, PortfolioExportStatus.FAILED)).toBe(1);

      const failedCall = m.jobRepoUpdate.mock.calls.find(
        (c) => c[1].status === PortfolioExportStatus.FAILED,
      );
      expect(failedCall![1].error).toMatch(/user.*deleted/i);

      // No aggregation, no upload, no token issuance — failed at the
      // user_id check.
      expect(m.analyticsGet).not.toHaveBeenCalled();
      expect(m.storageUpload).not.toHaveBeenCalled();
      expect(m.tokenIssue).not.toHaveBeenCalled();

      // Failure email goes to the address captured at request time
      // (still NOT NULL on the row even though user_id is NULL).
      expect(m.emailSend).toHaveBeenCalledTimes(1);
      expect(m.emailSend.mock.calls[0][0]).toBe('user@example.com');
    });
  });
});
