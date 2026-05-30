import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PortfolioExportTokenService } from '../services/portfolio-export-token.service';
import { StorageService } from '../../storage/storage.service';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import { getClientIp } from '../../../common/utils/get-client-ip.util';

/**
 * GET /api/v1/portfolio-exports/download?token=...
 *
 * BARE HTTP + token. No @UseGuards. No @Public() decorator either —
 * the SIGN codebase has NO global JwtAuthGuard registered (verified at
 * plan review §3 #11). Auth is opt-in per-controller; this controller
 * simply does not opt in. The token is the SOLE security gate.
 *
 * Verification chain runs in PortfolioExportTokenService.verify():
 *   1. parse format (no crypto, no DB)
 *   2. constant-time HMAC compare (no DB)
 *   3. payload JSON parse
 *   4. payload-side expiry claim
 *   5. DB existence + status COMPLETED + user_id match
 *   6. DB-side expires_at re-check (defense in depth)
 *
 * Every outcome — success and failure — writes a security audit row
 * (SecurityEventService.record, fire-and-forget). The HTTP response is
 * deliberately generic for failures so an attacker can't enumerate
 * which specific check failed:
 *   - malformed / invalid_signature → 401 Unauthorized
 *   - expired / not_found / file deleted between verify and stream → 410 Gone
 *
 * The audit row preserves the truth for forensics: which event type
 * actually fired, the IP, the user-agent, and the token's claimed
 * user_id (decoded from the payload — only present on signature-valid
 * tokens, which means the actor is *probably* legitimate but the row
 * is gone / cleaned / expired).
 */
@Controller('portfolio-exports')
export class PortfolioExportDownloadController {
  private readonly logger = new Logger(PortfolioExportDownloadController.name);

  constructor(
    private readonly tokens: PortfolioExportTokenService,
    private readonly storage: StorageService,
    private readonly audit: SecurityEventService,
  ) {}

  @Get('download')
  async download(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;

    const result = await this.tokens.verify(token);

    if (!result.ok) {
      // Map outcomes → HTTP. Failures collapse to two codes (401 / 410)
      // so a probe can't tell expired-vs-not_found apart.
      const reasonToEventType: Record<typeof result.reason, string> = {
        malformed: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_MALFORMED,
        invalid_signature: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_INVALID_SIGNATURE,
        expired: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_EXPIRED,
        not_found: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND,
      };
      const httpStatus =
        result.reason === 'malformed' || result.reason === 'invalid_signature' ? 401 : 410;

      await this.safeAudit({
        type: reasonToEventType[result.reason] as any,
        actor_id: null,
        organization_id: null,
        ip_address: ip,
        metadata: { reason: result.reason, user_agent: userAgent },
        entity_type: 'portfolio_export_job',
        entity_id: null,
      });

      res
        .status(httpStatus)
        .send(
          httpStatus === 401
            ? 'Invalid download link.'
            : 'This download link has expired or is no longer available.',
        );
      return;
    }

    // result.ok === true: the token verified AND the COMPLETED row was
    // found. Stream the file via StorageService (works for local + S3).
    const job = result.job;
    try {
      const buffer = await this.storage.getBuffer(job.file_path!);

      await this.safeAudit({
        type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_SUCCESS,
        actor_id: job.user_id,
        organization_id: job.org_id,
        ip_address: ip,
        metadata: { user_agent: userAgent },
        entity_type: 'portfolio_export_job',
        entity_id: job.id,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="portfolio-export-${job.id}.pdf"`,
      );
      res.end(buffer);
    } catch (err) {
      // Race: token verified + DB row valid + expires_at not yet reached,
      // but the cleanup cron (or any other process) deleted the file
      // between verify and stream. StorageService.getBuffer throws on a
      // missing file. Map this to 410 Gone — same response as expired /
      // not_found, no info leak about which it was. Audit log captures
      // the truth (not_found event type — the file is gone).
      this.logger.warn(
        `Portfolio export download race: token verified but file missing for job ${job.id}: ${(err as Error).message}`,
      );

      await this.safeAudit({
        type: SECURITY_EVENT_TYPES.PORTFOLIO_EXPORT_DOWNLOAD_NOT_FOUND,
        actor_id: job.user_id,
        organization_id: job.org_id,
        ip_address: ip,
        metadata: { reason: 'file_missing_after_verify', user_agent: userAgent },
        entity_type: 'portfolio_export_job',
        entity_id: job.id,
      });

      res.status(410).send('This download link is no longer available.');
    }
  }

  /**
   * Defense-in-depth wrap around SecurityEventService.record().
   *
   * The service's record() implementation today catches its own errors
   * (best-effort, logger.error on failure). This wrapper exists in case
   * that contract is ever violated by a future refactor: an audit-log
   * hiccup must NEVER turn a valid 200 download into a 500. The pattern
   * mirrors the established docusign.service.ts convention (caller-side
   * try/catch + logger.warn).
   *
   * Matters for the success path most of all — a leaked-token / replay
   * audit logging failure that 500'd a legitimate user's download would
   * be a self-inflicted DoS on the OWNER_ADMIN flow. The wrap also
   * applies to failure-outcome audit writes so failure responses can't
   * be turned into 500s either.
   */
  private async safeAudit(input: Parameters<SecurityEventService['record']>[0]): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.warn(
        `Failed to record audit event for portfolio export download: ${(err as Error).message}`,
      );
    }
  }
}
