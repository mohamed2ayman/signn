import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

/**
 * Normalizes 429 responses across all throttled endpoints.
 *
 * The ThrottlerGuard already sets the `Retry-After` header on the
 * response before throwing — we read it back, ensure it's present,
 * and emit a consistent JSON body that clients can rely on.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const headerValue = response.getHeader('Retry-After');
    let retryAfter = parseInt(String(headerValue ?? ''), 10);
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
      retryAfter = 60;
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message: `Too many attempts. Please try again in ${retryAfter} seconds.`,
      retryAfter,
    });
  }
}
