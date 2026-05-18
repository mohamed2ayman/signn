import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  TokenBlacklistService,
  TOKEN_BLACKLIST_REDIS,
} from './token-blacklist.service';

/**
 * Phase 4.2 — shared Redis client + TokenBlacklistService.
 *
 * Global so JwtStrategy and AuthService can inject without each module
 * re-importing this. A single ioredis connection is reused across the
 * app — never instantiate per-request.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TOKEN_BLACKLIST_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        return new Redis(url, {
          // Don't crash the app if Redis is temporarily unavailable; the
          // service has its own fail-open behavior.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
        });
      },
    },
    TokenBlacklistService,
  ],
  exports: [TokenBlacklistService, TOKEN_BLACKLIST_REDIS],
})
export class TokenBlacklistModule {}
