import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';
import { PortfolioExportTokenService } from '../services/portfolio-export-token.service';
import { PortfolioExportRendererService } from '../services/portfolio-export-renderer.service';
import { PortfolioAnalyticsService } from '../../portfolio-analytics/portfolio-analytics.service';
import { AnalyticsPeriod } from '../../admin-analytics/dto';
import { StorageService } from '../../storage/storage.service';
import { EmailService } from '../../notifications/email.service';
import { baseEmailLayout } from '../../notifications/templates/base-layout';
import {
  PORTFOLIO_EXPORT_TTL_HOURS,
  PORTFOLIO_EXPORT_TTL_MS,
} from '../portfolio-export.constants';

interface RenderExportJob {
  job_id: string;
}

/**
 * Phase 7.17 Prompt 2c Bucket 2 — portfolio export render processor.
 *
 * Concurrency: explicit `1` per #13. The codebase relies on Bull's
 * implicit default of 1 across all processors today; setting it
 * explicitly documents intent and guards against a future Bull→BullMQ
 * migration where the default may change.
 *
 * Failure semantics (user-mandated at plan review):
 *   - aggregation throws        → status=FAILED, no token, no file
 *   - storage upload fails      → status=FAILED, no token, no file
 *   - email send fails          → status=FAILED, no token, file CLEANED
 *
 * This diverges from compliance precedent in one specific way: email is
 * sent SYNCHRONOUSLY via `EmailService.sendGenericEmail()` + await, NOT
 * fire-and-forget via `NotificationDispatchService.enqueueEmail()`. The
 * spec mandates strict consistency between "row says COMPLETED" and
 * "user got the email" — that requires synchronous failure semantics.
 *
 * 1-attempt retry policy (Phase 7.17 Prompt 2c §13 + D2) — the queue
 * job is enqueued with `attempts: 1` in PortfolioExportService.
 * Surfacing failure fast > silently retrying a deterministic failure.
 */
@Processor('portfolio-export-jobs')
export class PortfolioExportProcessor {
  private readonly logger = new Logger(PortfolioExportProcessor.name);

  constructor(
    @InjectRepository(PortfolioExportJob)
    private readonly jobRepo: Repository<PortfolioExportJob>,
    private readonly analytics: PortfolioAnalyticsService,
    private readonly renderer: PortfolioExportRendererService,
    private readonly storage: StorageService,
    private readonly tokenService: PortfolioExportTokenService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  @Process({ name: 'render-export', concurrency: 1 })
  async handleRenderExport(job: Job<RenderExportJob>): Promise<void> {
    const jobId = job.data.job_id;
    this.logger.log(`Rendering portfolio export jobId=${jobId}`);

    const row = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!row) {
      this.logger.error(`Portfolio export job ${jobId} not found — dropping`);
      return;
    }

    // Track the uploaded file_url so the catch block can clean up if any
    // later step fails. Stays null until upload succeeds.
    let uploadedFileUrl: string | null = null;

    try {
      // ── 1. Mark RUNNING ──────────────────────────────────────────
      await this.jobRepo.update(jobId, { status: PortfolioExportStatus.RUNNING });

      // ── 2. Defend against the "user deleted between request and
      //       processor" race. user_id is nullable + ON DELETE SET NULL
      //       (intentional — preserves audit row); the token verifier
      //       requires user_id binding, so a NULLed row can no longer
      //       satisfy any token. Fail fast and surface to the user.
      if (!row.user_id) {
        throw new Error('Requesting user was deleted before the export could be generated');
      }

      // ── 3. Run the 9 aggregations against the live schema ────────
      const analyticsResponse = await this.analytics.getPortfolioAnalytics(
        row.org_id,
        row.period as AnalyticsPeriod,
        row.project_id ?? undefined,
      );

      // ── 4. Render the PDF (EN-only labels, Latin numerals #137) ──
      const buffer = await this.renderer.render(analyticsResponse, {
        // Bucket 2 keeps the cover-page strings minimal — we have the
        // requester's email captured on the row but no display name.
        // The renderer can take the email as the display + identifier.
        orgName: row.org_id, // org display name resolution is a polish item — v2 will JOIN orgs.name.
        requesterName: row.email,
        requesterEmail: row.email,
        period: row.period,
        projectName: null,
        generatedAt: new Date(),
      });

      // ── 5. Upload via the StorageService abstraction (9.1a) ──────
      const filename = `portfolio-export-${jobId}.pdf`;
      const uploaded = await this.storage.uploadBuffer(
        buffer,
        'portfolio-exports',
        filename,
        'application/pdf',
      );
      uploadedFileUrl = uploaded.file_url;

      // ── 6. Issue the HMAC token (in-memory — only persisted via
      //       expires_at on the row once the email succeeds) ──────
      const expiresAt = new Date(Date.now() + PORTFOLIO_EXPORT_TTL_MS);
      const token = this.tokenService.issue(jobId, row.user_id, expiresAt);

      // ── 7. Build the download URL + email body ───────────────────
      const baseUrl = this.config.get<string>('BASE_URL') ?? 'http://localhost:3000';
      const downloadUrl =
        `${baseUrl}/api/v1/portfolio-exports/download?token=${encodeURIComponent(token)}`;

      // ── 8. SEND THE EMAIL (sync + throws on failure — divergence
      //       from compliance's fire-and-forget; enforces the
      //       user-mandated COMPLETED-implies-email-delivered
      //       consistency) ─────────────────────────────────────────
      await this.emailService.sendGenericEmail(
        row.email,
        '[SIGN] Your portfolio export is ready',
        this.renderSuccessEmail({
          downloadUrl,
          expiresInHours: PORTFOLIO_EXPORT_TTL_HOURS,
          period: row.period,
        }),
      );

      // ── 9. ONLY NOW persist completion ───────────────────────────
      //       file_path = canonical file_url (StorageService convention,
      //       enables S3-adapter compatibility per 9.1a). expires_at
      //       mirrors the token claim so verify() DB re-check matches.
      await this.jobRepo.update(jobId, {
        status: PortfolioExportStatus.COMPLETED,
        file_path: uploadedFileUrl,
        expires_at: expiresAt,
        completed_at: new Date(),
      });

      this.logger.log(`Portfolio export ${jobId} COMPLETED → emailed to ${row.email}`);
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error';
      this.logger.error(`Portfolio export ${jobId} FAILED: ${message}`);

      // ── A. Clean up the uploaded file if upload succeeded but a
      //       later step (token issuance / email send) failed. Without
      //       this cleanup the file orphans — the cleanup cron only
      //       deletes rows with expires_at set, which a FAILED row
      //       never has. StorageService.deleteFile is best-effort and
      //       never throws.
      if (uploadedFileUrl) {
        try {
          await this.storage.deleteFile(uploadedFileUrl);
          this.logger.log(`Cleaned up orphan file ${uploadedFileUrl} for failed job ${jobId}`);
        } catch (cleanupErr) {
          this.logger.error(
            `Failed to clean up file ${uploadedFileUrl} for job ${jobId}:`,
            cleanupErr,
          );
        }
      }

      // ── B. Mark FAILED. file_path + expires_at intentionally left
      //       unset so verify() finds no row + the cleanup cron
      //       (Bucket 3) does not try to re-delete an already-cleaned
      //       file.
      await this.jobRepo.update(jobId, {
        status: PortfolioExportStatus.FAILED,
        error: message,
      });

      // ── C. Best-effort failure email. We're already in the failure
      //       path — if THIS also fails, all we can do is log. Don't
      //       throw; Bull would mark the job failed again and re-call
      //       this whole handler under any future retry policy.
      try {
        await this.emailService.sendGenericEmail(
          row.email,
          '[SIGN] Portfolio export failed',
          this.renderFailureEmail({ period: row.period }),
        );
      } catch (emailErr) {
        this.logger.error(`Failed to send failure email for job ${jobId}:`, emailErr);
      }
    }
  }

  // ─── Email templates (inline — matches compliance precedent) ─────

  private renderSuccessEmail(input: {
    downloadUrl: string;
    expiresInHours: number;
    period: string;
  }): string {
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your Portfolio Export Is Ready</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        Your portfolio analytics snapshot (period: ${input.period}) has been generated.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${input.downloadUrl}"
             style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">
            Download Portfolio Snapshot
          </a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">
        This download link expires in <strong>${input.expiresInHours} hour${input.expiresInHours === 1 ? '' : 's'}</strong>.
        Single email delivery — if you don't receive this email or the link expires before you can use it,
        please re-export from the portfolio page. The PDF is watermarked, non-editable, and confidential
        — please do not redistribute.
      </p>
    `;
    return baseEmailLayout(content, {
      preheader: 'Your portfolio export is ready to download',
    });
  }

  private renderFailureEmail(input: { period: string }): string {
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Portfolio Export Failed</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        We were unable to generate your portfolio analytics snapshot (period: ${input.period}).
      </p>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        Please try again from the portfolio page. If the problem persists, contact your administrator.
      </p>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">
        No file or download link was created for this failed request — there is nothing to clean up
        on your end.
      </p>
    `;
    return baseEmailLayout(content, {
      preheader: 'Portfolio export request failed',
    });
  }
}
