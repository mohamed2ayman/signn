import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SessionService } from '../services/session.service';

/**
 * Best-effort `last_active_at` updater. Runs after the JWT guard
 * (mounted on authenticated routes) and uses the access JWT's `jti`
 * claim if present, falling back to a hash of the bearer token to
 * find the matching UserSession row. Failures are swallowed — this
 * middleware must never block a request.
 */
@Injectable()
export class SessionTrackingMiddleware implements NestMiddleware {
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
    const session = await this.sessions.findByTokenHash(raw);
    if (session) await this.sessions.touch(session.id);
  }
}
