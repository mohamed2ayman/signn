import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c — HMAC-signed download tokens for portfolio exports.
 *
 * Wire format (JWT-shaped, two-part):
 *   `<base64url(payload_json)>.<base64url(hmac_sha256(b64_payload))>`
 *
 * Signing the base64url-encoded payload (not the raw JSON) keeps the
 * input to the HMAC byte-deterministic on the wire — no parser-roundtrip
 * ambiguity, no whitespace normalization concerns.
 *
 * The verification order is deliberate and tested:
 *   1. Format check (no crypto, no DB).
 *   2. Constant-time HMAC compare (no DB).
 *   3. Payload JSON parse + shape check.
 *   4. Payload expiry claim check (no DB).
 *   5. DB existence + status COMPLETED + user_id match.
 *   6. DB-side expires_at re-check (defense in depth).
 *
 * The HMAC-before-DB ordering is the security floor. There is no global
 * JwtAuthGuard behind the download endpoint (verified at plan review §3 #11);
 * if the DB read ever moves ahead of the signature check, Postgres becomes
 * the unauthenticated attack surface under a forged-token spray. A
 * regression test asserts no `jobRepo.findOne` call when the HMAC fails —
 * any refactor that reorders verify() will break the test, not silently
 * regress the invariant.
 *
 * PORTFOLIO_EXPORT_DOWNLOAD_SECRET is the ENTIRE security floor for the
 * download endpoint (per the same §3 #11 finding). Joi enforces
 * `.min(32).required()` at startup so the app refuses to boot below the
 * floor; this service throws (rather than fall back to a weak default) if
 * it's ever called before bootstrap or from a non-Nest context.
 */

export interface PortfolioExportTokenPayload {
  job_id: string;
  user_id: string;
  /** Unix seconds. Same encoding as ObligationTokenService for consistency. */
  expires_at: number;
}

export type TokenVerifyResult =
  | { ok: true; job: PortfolioExportJob }
  | {
      ok: false;
      reason: 'malformed' | 'invalid_signature' | 'expired' | 'not_found';
    };

@Injectable()
export class PortfolioExportTokenService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PortfolioExportJob)
    private readonly jobRepo: Repository<PortfolioExportJob>,
  ) {}

  /**
   * Issue a token bound to a specific (job, user, expiry). The caller is
   * responsible for persisting the same expiry on the job row so the
   * DB-side re-check in verify() matches.
   */
  issue(jobId: string, userId: string, expiresAt: Date): string {
    const payload: PortfolioExportTokenPayload = {
      job_id: jobId,
      user_id: userId,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    };
    const payloadB64 = Buffer.from(
      JSON.stringify(payload),
      'utf-8',
    ).toString('base64url');
    const sigB64 = this.sign(payloadB64);
    return `${payloadB64}.${sigB64}`;
  }

  async verify(token: string): Promise<TokenVerifyResult> {
    // ── 1. Format ─────────────────────────────────────────────────────
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'malformed' };
    }
    const dotIdx = token.indexOf('.');
    if (dotIdx <= 0 || dotIdx === token.length - 1) {
      return { ok: false, reason: 'malformed' };
    }
    const payloadB64 = token.slice(0, dotIdx);
    const sigB64 = token.slice(dotIdx + 1);

    // ── 2. Constant-time HMAC compare — BEFORE any DB call ────────────
    // Any refactor that moves the jobRepo call above this block will
    // be caught by the no-DB-on-HMAC-fail regression test.
    const expectedSigB64 = this.sign(payloadB64);
    const sigBuf = Buffer.from(sigB64, 'base64url');
    const expectedBuf = Buffer.from(expectedSigB64, 'base64url');
    if (sigBuf.length !== expectedBuf.length) {
      return { ok: false, reason: 'invalid_signature' };
    }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    // ── 3. Parse payload (signature already validated) ────────────────
    let payload: PortfolioExportTokenPayload;
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      payload = JSON.parse(json) as PortfolioExportTokenPayload;
    } catch {
      // Reaching this branch requires the attacker to know the HMAC secret
      // (otherwise the HMAC check above rejects). Defensive only.
      return { ok: false, reason: 'malformed' };
    }
    if (
      typeof payload.job_id !== 'string' ||
      typeof payload.user_id !== 'string' ||
      typeof payload.expires_at !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }

    // ── 4. Payload expiry claim ───────────────────────────────────────
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.expires_at <= nowSec) {
      return { ok: false, reason: 'expired' };
    }

    // ── 5. DB existence + completion + user binding ───────────────────
    const job = await this.jobRepo.findOne({
      where: {
        id: payload.job_id,
        user_id: payload.user_id,
        status: PortfolioExportStatus.COMPLETED,
      },
    });
    if (!job) {
      return { ok: false, reason: 'not_found' };
    }

    // ── 6. DB-side expires_at re-check — defense in depth ─────────────
    if (!job.expires_at || job.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, job };
  }

  /**
   * HMAC-SHA256 over the base64url-encoded payload. Output base64url to
   * stay consistent with the wire format. Throws if the secret env var
   * is missing — this is unreachable under normal Nest bootstrap
   * (Joi-required), but fails loudly if anyone instantiates the service
   * outside a properly-configured app.
   */
  private sign(payloadB64: string): string {
    const secret = this.config.get<string>('PORTFOLIO_EXPORT_DOWNLOAD_SECRET');
    if (!secret) {
      throw new Error(
        'PORTFOLIO_EXPORT_DOWNLOAD_SECRET is not configured — cannot sign portfolio export tokens',
      );
    }
    return crypto
      .createHmac('sha256', secret)
      .update(payloadB64)
      .digest('base64url');
  }
}
