import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import {
  GuestInvitation,
  GuestInvitationStatus,
} from '../../../database/entities';

/**
 * Phase 7.18 bucket 1b-i — HMAC-signed guest-invitation token.
 *
 * Wire format (JWT-shaped, two-part):
 *   `<base64url(payload_json)>.<base64url(hmac_sha256(b64_payload))>`
 *
 * Verification order — deliberate and tested. Any refactor that reorders
 * the steps must update the regression test in
 * `invitation-token.service.spec.ts`.
 *
 *   1. Format check               (no crypto, no DB)
 *   2. Constant-time HMAC compare (no DB) ──── security floor
 *   3. Payload JSON parse + shape check
 *   4. Payload expiry claim
 *   5. DB existence + status PENDING|ACCEPTED + revoked_at IS NULL
 *      + DB-side expires_at re-check (defense in depth)
 *
 * GUEST_INVITE_SECRET is the entire security floor on the public
 * exchange endpoint. Joi enforces `.min(32).required()` at startup so the
 * app refuses to boot below the floor; this service throws (rather than
 * fall back to a weak default) if it is ever called before bootstrap.
 *
 * NOTE — bucket 1b-i is the READ path only. ACCEPTED is treated the same
 * as PENDING here: an already-exchanged invitation may be re-exchanged
 * within TTL to mint a fresh viewer credential (e.g. if the recipient
 * comes back the next day on the same device). The gating axes are
 * revoke + expiry; status is just an accept-stamp marker that 1b-ii
 * will lean on when promoting the invitation to a durable identity.
 */

export interface InvitationTokenPayload {
  /** The GuestInvitation.id this token authenticates against. */
  invitation_id: string;
  /** Unix seconds. Same encoding as ObligationTokenService for consistency. */
  expires_at: number;
}

export type InvitationVerifyResult =
  | { ok: true; invitation: GuestInvitation }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'invalid_signature'
        | 'expired'
        | 'revoked'
        | 'not_found';
    };

@Injectable()
export class InvitationTokenService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GuestInvitation) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
    private readonly invitationRepo: Repository<GuestInvitation>,
  ) {}

  /**
   * Issue a token bound to a specific (invitation, expiry). The caller is
   * responsible for persisting the same expires_at on the invitation row
   * so the DB-side re-check in verify() matches.
   */
  issue(invitationId: string, expiresAt: Date): string {
    const payload: InvitationTokenPayload = {
      invitation_id: invitationId,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString(
      'base64url',
    );
    const sigB64 = this.sign(payloadB64);
    return `${payloadB64}.${sigB64}`;
  }

  async verify(token: string): Promise<InvitationVerifyResult> {
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
    let payload: InvitationTokenPayload;
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      payload = JSON.parse(json) as InvitationTokenPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (
      typeof payload.invitation_id !== 'string' ||
      typeof payload.expires_at !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }

    // ── 4. Payload expiry claim ───────────────────────────────────────
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.expires_at <= nowSec) {
      return { ok: false, reason: 'expired' };
    }

    // ── 5. DB checks ──────────────────────────────────────────────────
    const invitation = await this.invitationRepo.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { id: payload.invitation_id },
    });
    if (!invitation) {
      return { ok: false, reason: 'not_found' };
    }
    if (
      invitation.status === GuestInvitationStatus.REVOKED ||
      invitation.revoked_at !== null
    ) {
      return { ok: false, reason: 'revoked' };
    }
    if (!invitation.expires_at || invitation.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, invitation };
  }

  private sign(payloadB64: string): string {
    const secret = this.config.get<string>('GUEST_INVITE_SECRET');
    if (!secret) {
      throw new Error(
        'GUEST_INVITE_SECRET is not configured — cannot sign guest invitation tokens',
      );
    }
    return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  }
}
