import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityPolicy } from '../../../database/entities';

/**
 * Read/write the singleton SecurityPolicy row (id='global'). Caches the
 * row in-process for 60s so the IpFilterMiddleware (which runs on every
 * request) doesn't hit the DB on the hot path.
 *
 * `bumpCache()` invalidates the cache — called on every PUT.
 */
@Injectable()
export class SecurityPolicyService {
  static readonly SINGLETON_ID = 'global';
  private static readonly CACHE_TTL_MS = 60_000;

  private readonly logger = new Logger(SecurityPolicyService.name);
  private cache: { value: SecurityPolicy; loadedAt: number } | null = null;

  constructor(
    @InjectRepository(SecurityPolicy)
    private readonly repo: Repository<SecurityPolicy>,
  ) {}

  /** Loads the singleton row. Throws if the migration seed is missing. */
  async get(): Promise<SecurityPolicy> {
    const row = await this.repo.findOne({
      where: { id: SecurityPolicyService.SINGLETON_ID },
    });
    if (!row) {
      throw new NotFoundException(
        'SecurityPolicy singleton row missing — migration not run?',
      );
    }
    return row;
  }

  /** Cached read for hot paths (middleware). Re-loads after 60s. */
  async getCached(): Promise<SecurityPolicy> {
    const now = Date.now();
    if (
      this.cache &&
      now - this.cache.loadedAt < SecurityPolicyService.CACHE_TTL_MS
    ) {
      return this.cache.value;
    }
    const value = await this.get();
    this.cache = { value, loadedAt: now };
    return value;
  }

  /** Invalidate cache. Called from update() and tests. */
  bumpCache(): void {
    this.cache = null;
  }

  /**
   * Update the singleton policy. Returns `{ before, after, changedFields }`
   * so the controller can emit one SETTINGS_CHANGED audit row per field.
   */
  async update(
    patch: Partial<SecurityPolicy>,
    actorUserId: string | null,
  ): Promise<{
    before: SecurityPolicy;
    after: SecurityPolicy;
    changedFields: string[];
  }> {
    const before = await this.get();

    // Diff incoming patch against current row
    const changedFields: string[] = [];
    for (const key of Object.keys(patch) as (keyof SecurityPolicy)[]) {
      if (key === 'id' || key === 'updated_at' || key === 'updated_by') continue;
      const next = patch[key];
      if (next === undefined) continue;
      if (JSON.stringify(next) !== JSON.stringify(before[key])) {
        changedFields.push(key as string);
      }
    }

    if (changedFields.length === 0) {
      return { before, after: before, changedFields: [] };
    }

    await this.repo.update(
      { id: SecurityPolicyService.SINGLETON_ID },
      {
        ...patch,
        updated_by: actorUserId ?? undefined,
      } as any,
    );
    this.bumpCache();

    const after = await this.get();
    this.logger.log(
      `SecurityPolicy updated by ${actorUserId ?? 'system'} — ${changedFields.length} field(s) changed`,
    );
    return { before, after, changedFields };
  }
}
