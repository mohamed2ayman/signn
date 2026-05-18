import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export const TOKEN_BLACKLIST_REDIS = 'TOKEN_BLACKLIST_REDIS';

/**
 * Phase 4.2 — Redis-backed access-token blacklist.
 *
 * Access tokens are short-lived (default 15 minutes). When a user logs
 * out we set a Redis key `blacklist:jti:{jti}` with a TTL equal to the
 * remaining lifetime of the token. JwtStrategy.validate() checks this
 * key on every authenticated request — if present, the request is
 * rejected with 401 even though the JWT signature is still valid.
 *
 * Key format: `blacklist:jti:{jti}` — value is unused (we only check
 * EXISTS). TTL ensures Redis self-cleans expired entries.
 *
 * Why not blacklist refresh tokens here? Refresh tokens have a DB row
 * (`user_sessions`) we can flip to revoked. Access tokens have no row
 * (issuing them on every request would be wasteful) so Redis is the
 * correct revocation store for them.
 */
@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(@Inject(TOKEN_BLACKLIST_REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      // Best-effort. The shared client is owned by us, so close it.
      await this.redis.quit();
    } catch (err) {
      // Ignore — process is shutting down anyway.
      this.logger.debug?.(`Redis quit error: ${(err as Error).message}`);
    }
  }

  /**
   * Adds a jti to the blacklist with a TTL.
   * No-op when ttl <= 0 (token is already expired naturally).
   */
  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    if (!jti) return;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
    try {
      await this.redis.set(`blacklist:jti:${jti}`, '1', 'EX', Math.ceil(ttlSeconds));
    } catch (err) {
      // Logout must not fail because of Redis. The session row revocation
      // is the authoritative refresh-token barrier; this is a 15-min
      // best-effort cap on the access token.
      this.logger.error(
        `[blacklistToken] Redis SET failed for jti=${jti}: ${(err as Error).message}`,
      );
    }
  }

  /** Returns true if the jti is blacklisted. Fails-open on Redis error. */
  async isBlacklisted(jti: string): Promise<boolean> {
    if (!jti) return false;
    try {
      const exists = await this.redis.exists(`blacklist:jti:${jti}`);
      return exists === 1;
    } catch (err) {
      this.logger.error(
        `[isBlacklisted] Redis EXISTS failed for jti=${jti}: ${(err as Error).message}`,
      );
      // Fail-open: do not lock everyone out if Redis goes down. The
      // session row revocation still catches refresh-token reuse.
      return false;
    }
  }
}
