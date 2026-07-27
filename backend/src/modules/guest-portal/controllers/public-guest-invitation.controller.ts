import { Body, Controller, HttpCode, HttpStatus, Ip, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ThrottleOnly } from '../../../common/decorators/throttle-only.decorator';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { ExchangeTokenDto } from '../dto/exchange-token.dto';
import { EstablishIdentityDto } from '../dto/establish-identity.dto';

/**
 * Phase 7.18 bucket 1b-i — PUBLIC token-exchange endpoint.
 *
 * No JwtAuthGuard. The HMAC verification in InvitationTokenService is
 * the security floor on this surface. A separate rate-limit bucket
 * (`guest_invite_exchange`) caps token-spray attacks.
 *
 * Returns a SHORT-LIVED viewer credential plus the minimum landing info.
 * The invitation token is NEVER echoed back to the caller and NEVER
 * accepted as a contract-read credential. The only credential that
 * works on /viewer/contracts/:id is the viewer credential issued here.
 *
 * Route prefix `public/` mirrors the existing precedent in
 * compliance/PublicObligationController — it documents intent at the
 * URL layer ("this is bare HTTP + token only") and keeps the surface
 * easy to grep for security review.
 */
@Controller('public/guest-invitations')
export class PublicGuestInvitationController {
  constructor(private readonly invitations: GuestInvitationService) {}

  @Post('exchange')
  @ThrottleOnly('guest_invite_exchange')
  @HttpCode(HttpStatus.OK)
  async exchange(@Body() dto: ExchangeTokenDto) {
    return this.invitations.exchange(dto.token);
  }

  /**
   * Phase 7.18 bucket 1b-ii — viewer→guest-user identity transition.
   *
   * Takes the invitation token + a new password + a captured intent.
   * Atomically creates a guest user, writes the contract binding, flips
   * the invitation to ACCEPTED, and returns a STANDARD JWT pair (Decision
   * 4). The viewer credential becomes irrelevant from this point on —
   * the guest authenticates with the JWT going forward.
   *
   * Public + throttled (same bucket as /exchange). HMAC verification +
   * the password-check race-guard are the security floor.
   */
  @Post('establish-identity')
  @ThrottleOnly('guest_invite_exchange')
  @HttpCode(HttpStatus.OK)
  async establishIdentity(
    @Body() dto: EstablishIdentityDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    // Layer A — never RETURN the refresh token to a guest client. It is still
    // MINTED inside the service (issueGuestSession → _finalizeLogin → the
    // user_sessions SHA-256 row all complete BEFORE the service returns), so the
    // session machinery is whole; we only omit it from the HTTP response so a
    // guest holds an access-token-only session and cannot silently refresh.
    // Mirrors the MFA branch, which already returns refresh_token: null.
    const result = await this.invitations.establishIdentity(dto, {
      ip: ip ?? null,
      user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    return { ...result, refresh_token: null };
  }
}
