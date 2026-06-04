import { ForbiddenException } from '@nestjs/common';

import { MeterKey } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Thrown when a reserve() call would exceed the resolved limit. Error shape
 * mirrors SubscriptionGuard's existing envelope so frontend handlers can
 * treat plan-driven enforcement uniformly:
 *
 *   { statusCode: 403, error: 'METER_LIMIT_<METER_KEY>', limit, current }
 *
 * (audit §C.2 — extends, does NOT replace, the dead-code SubscriptionGuard
 * pattern. SubscriptionGuard is not wired in Part 1; if it is wired later,
 * its error envelope and this one should remain in lockstep.)
 */
export class MeterLimitExceededError extends ForbiddenException {
  public readonly limit: number;
  public readonly current: number;
  public readonly meter_key: MeterKey;

  constructor(meterKey: MeterKey, limit: number, current: number) {
    super({
      statusCode: 403,
      error: `METER_LIMIT_${meterKey.toUpperCase()}`,
      message:
        `Meter limit reached for ${meterKey}: ` +
        `${current}/${limit} already consumed in the current window.`,
      meter_key: meterKey,
      limit,
      current,
    });
    this.limit = limit;
    this.current = current;
    this.meter_key = meterKey;
  }
}
