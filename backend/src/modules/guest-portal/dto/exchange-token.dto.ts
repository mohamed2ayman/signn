import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 7.18 bucket 1b-i — public token-exchange request body.
 *
 * The token is the long-lived HMAC-signed value that was emailed (or
 * given out by other means in 1b-i; email send is bucket 7). It is
 * NEVER reused as a per-request credential — exchange returns a separate
 * short-lived viewer credential, and contract reads only accept that.
 */
export class ExchangeTokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(2048)
  token: string;
}
