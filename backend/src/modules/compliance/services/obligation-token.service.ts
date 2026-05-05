import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface MarkMetTokenPayload {
  obligation_id: string;
  user_id: string;
  expires_at: number; // unix seconds
  nonce: string;
}

/**
 * HMAC-signed mark-as-met tokens embedded in reminder emails.
 *
 * Token format: base64url(`{payload_json}.{hmac}`)
 *   - payload: {obligation_id, user_id, expires_at, nonce}
 *   - hmac:    HMAC-SHA256(JWT_SECRET, payload_json)
 *
 * Single-use is enforced by storing the nonce on the obligation row
 * (`mark_met_token`) and clearing it on first use.
 */
@Injectable()
export class ObligationTokenService {
  private static readonly DEFAULT_TTL_DAYS = 7;

  constructor(private readonly config: ConfigService) {}

  issue(obligationId: string, userId: string, ttlDays?: number): { token: string; nonce: string; expiresAt: Date } {
    const ttl = ttlDays ?? ObligationTokenService.DEFAULT_TTL_DAYS;
    const expires = Math.floor(Date.now() / 1000) + ttl * 24 * 60 * 60;
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload: MarkMetTokenPayload = {
      obligation_id: obligationId,
      user_id: userId,
      expires_at: expires,
      nonce,
    };
    const json = JSON.stringify(payload);
    const hmac = this.sign(json);
    const token = this.b64(`${json}.${hmac}`);
    return { token, nonce, expiresAt: new Date(expires * 1000) };
  }

  verify(token: string): { ok: boolean; payload?: MarkMetTokenPayload; reason?: string } {
    try {
      const decoded = this.unb64(token);
      const dot = decoded.lastIndexOf('.');
      if (dot < 0) return { ok: false, reason: 'malformed' };
      const json = decoded.slice(0, dot);
      const hmac = decoded.slice(dot + 1);
      const expected = this.sign(json);
      if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
        return { ok: false, reason: 'bad signature' };
      }
      const payload = JSON.parse(json) as MarkMetTokenPayload;
      if (payload.expires_at < Math.floor(Date.now() / 1000)) {
        return { ok: false, reason: 'expired' };
      }
      return { ok: true, payload };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  private sign(payloadJson: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? 'dev-jwt-secret';
    return crypto
      .createHmac('sha256', secret)
      .update(payloadJson)
      .digest('hex');
  }

  private b64(s: string): string {
    return Buffer.from(s, 'utf-8').toString('base64url');
  }
  private unb64(s: string): string {
    return Buffer.from(s, 'base64url').toString('utf-8');
  }
}
