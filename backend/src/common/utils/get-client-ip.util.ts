import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Single source of truth for client-IP extraction.
 *
 * Order of precedence:
 *   1. First entry of X-Forwarded-For (trimmed)
 *   2. req.ip (honors `trust proxy`)
 *   3. req.socket.remoteAddress
 *   4. '0.0.0.0' (never throws — IP must always resolve to a string
 *      because rate-limit keys, audit rows and security events
 *      cannot accept null)
 *
 * Accepts either a raw Express Request or a NestJS ExecutionContext
 * so it can be called from guards, middleware, interceptors and
 * controllers without ceremony.
 */
export function getClientIp(source: ExecutionContext | Request): string {
  const req: Request = isExecutionContext(source)
    ? source.switchToHttp().getRequest<Request>()
    : source;

  const xff = req?.headers?.['x-forwarded-for'];
  const xffFirst = Array.isArray(xff)
    ? xff[0]?.trim()
    : typeof xff === 'string'
    ? xff.split(',')[0]?.trim()
    : undefined;

  return (
    xffFirst ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    '0.0.0.0'
  );
}

function isExecutionContext(
  source: ExecutionContext | Request,
): source is ExecutionContext {
  return (
    typeof (source as ExecutionContext).switchToHttp === 'function'
  );
}
