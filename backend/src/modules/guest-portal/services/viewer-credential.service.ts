import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Phase 7.18 bucket 1b-i — SHORT-LIVED pre-password viewer credential.
 *
 * Issued at exchange time (POST /public/guest-invitations/exchange), the
 * viewer credential is a stateless HMAC-signed token scoped to ONE
 * contract. The recipient carries it as:
 *
 *   Authorization: Viewer <token>
 *
 * on contract reads. The credential grants:
 *   • READ on the bound contract_id (and its existing AI clause
 *     classification — zero new cost).
 *
 * The credential grants NOTHING else. No writes, no comments, no signs,
 * no uploads, no metering operations, no access to a different contract.
 * Anything outside the bound contract_id MUST return 404 via the
 * existing ContractAccessService convention.
 *
 * Stateless by design — no DB lookup at request time. The acceptable
 * window between viewer-credential issuance and revocation effect is the
 * GUEST_VIEWER_TTL_MINUTES (default 15). Revocation of the parent
 * invitation kills NEW exchanges immediately; in-flight viewer
 * credentials expire on their own clock. This trade is the same one
 * portfolio-export tokens make — and is documented as such.
 *
 * GUEST_VIEWER_SECRET is intentionally DISTINCT from GUEST_INVITE_SECRET
 * so a compromise of one cannot mint the other.
 *
 * Wire format mirrors InvitationTokenService:
 *   `<base64url(payload)>.<base64url(hmac_sha256(b64_payload))>`
 */

export interface ViewerCredentialPayload {
  /** The single contract this credential grants read on. */
  contract_id: string;
  /**
   * The invitation that minted this credential. Carried for audit and
   * for the (later, 1b-ii) link to the durable guest identity. NOT used
   * by the verifier — verification is stateless on TTL + HMAC.
   */
  invitation_id: string;
  /** Unix seconds. */
  expires_at: number;
}

export type ViewerVerifyResult =
  | { ok: true; payload: ViewerCredentialPayload }
  | {
      ok: false;
      reason: 'malformed' | 'invalid_signature' | 'expired';
    };

@Injectable()
export class ViewerCredentialService {
  constructor(private readonly config: ConfigService) {}

  issue(contractId: string, invitationId: string): { token: string; expires_at: Date } {
    const ttlMinutes = this.ttlMinutes();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const payload: ViewerCredentialPayload = {
      contract_id: contractId,
      invitation_id: invitationId,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString(
      'base64url',
    );
    const sigB64 = this.sign(payloadB64);
    return { token: `${payloadB64}.${sigB64}`, expires_at: expiresAt };
  }

  /** Stateless verification — no DB call. Used by the request-time guard. */
  verify(token: string): ViewerVerifyResult {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'malformed' };
    }
    const dotIdx = token.indexOf('.');
    if (dotIdx <= 0 || dotIdx === token.length - 1) {
      return { ok: false, reason: 'malformed' };
    }
    const payloadB64 = token.slice(0, dotIdx);
    const sigB64 = token.slice(dotIdx + 1);

    // Constant-time HMAC compare.
    const expectedSigB64 = this.sign(payloadB64);
    const sigBuf = Buffer.from(sigB64, 'base64url');
    const expectedBuf = Buffer.from(expectedSigB64, 'base64url');
    if (sigBuf.length !== expectedBuf.length) {
      return { ok: false, reason: 'invalid_signature' };
    }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    let payload: ViewerCredentialPayload;
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      payload = JSON.parse(json) as ViewerCredentialPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (
      typeof payload.contract_id !== 'string' ||
      typeof payload.invitation_id !== 'string' ||
      typeof payload.expires_at !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.expires_at <= nowSec) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, payload };
  }

  ttlMinutes(): number {
    const raw = this.config.get<number>('GUEST_VIEWER_TTL_MINUTES', 15);
    return Number(raw);
  }

  private sign(payloadB64: string): string {
    const secret = this.config.get<string>('GUEST_VIEWER_SECRET');
    if (!secret) {
      throw new Error(
        'GUEST_VIEWER_SECRET is not configured — cannot sign viewer credentials',
      );
    }
    return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  }
}
