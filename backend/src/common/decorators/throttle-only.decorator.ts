import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Names of all rate-limit buckets configured in ThrottlerModule
 * (see app.module.ts → ThrottlerModule.forRootAsync()).
 *
 * Keep this list in lock-step with the module config. The
 * Rate Limiting Policy in CLAUDE.md is the canonical source.
 */
export const THROTTLER_NAMES = [
  'login',
  'register',
  'forgot',
  'reset',
  'mfa',
  'recovery',
  'refresh',
  'invitation',
  'waitlist',
] as const;

export type ThrottlerName = (typeof THROTTLER_NAMES)[number];

/**
 * Apply EXACTLY ONE named throttler to an endpoint.
 *
 * NestJS ThrottlerGuard runs every named throttler configured at the
 * module level — so without this helper, a method decorated with
 * `@Throttle({ login: {} })` would still be blocked by every other
 * named throttler's default limit. This decorator skips all the
 * unrelated buckets so the endpoint only obeys its own limit.
 */
export function ThrottleOnly(name: ThrottlerName): MethodDecorator {
  const skipMap: Record<string, boolean> = {};
  for (const n of THROTTLER_NAMES) {
    if (n !== name) skipMap[n] = true;
  }
  return applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({ [name]: {} }),
    SkipThrottle(skipMap),
  );
}
