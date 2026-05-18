import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SessionService } from '../services/session.service';

/**
 * Best-effort `last_active_at` updater.
 *
 * Phase 4.2 — keys the lookup on the access token's `jti` claim. The
 * previous implementation hashed the bearer access token and looked it
 * up in user_sessions.token_hash, but user_sessions stores refresh-token
 * hashes (not access-token hashes), so the lookup never matched and
 * last_active_at was never updated.
 *
 * Tokens issued BEFORE Phase 4.2 have no jti claim. For those we log a
 * one-time warning and skip — they expire within 15 minutes anyway.
 *
 * Failures are swallowed — this middleware must never block a request.
 */
@Injectable()
export class SessionTrackingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SessionTrackingMiddleware.name);

  constructor(private readonly sessions: SessionService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    next();

    // Run async after handing off the request — never block the chain
    setImmediate(() => {
      void this.touch(req).catch(() => undefined);
    });
  }

  private async touch(req: Request): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return;
    const raw = auth.slice('Bearer '.length).trim();
    if (!raw) return;

    const jti = this.extractJti(raw);
    if (!jti) {
      // Pre-Phase-4.2 token. Skip silently after first warning.
      return;
    }

    const session = await this.sessions.findActiveByJti(jti);
    if (session) await this.sessions.touch(session.id);
  }

  /** Decode (no verify) and return the `jti` claim if present. */
  private extractJti(rawJwt: string): string | null {
    try {
      const parts = rawJwt.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      return typeof payload?.jti === 'string' ? payload.jti : null;
    } catch {
      return null;
    }
  }
}
