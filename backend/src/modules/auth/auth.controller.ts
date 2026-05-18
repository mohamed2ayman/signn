import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { ThrottleOnly } from '../../common/decorators/throttle-only.decorator';
import {
  RegisterDto,
  LoginDto,
  VerifyMfaDto,
  RefreshTokenDto,
  AcceptInvitationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  EnableMfaTotpDto,
  DisableMfaDto,
  VerifyRecoveryDto,
  ChangePasswordDto,
} from './dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getClientIp } from '../../common/utils/get-client-ip.util';

function ctxOf(req: Request) {
  return {
    ip: getClientIp(req),
    user_agent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Phase 4.2 — extract jti + exp from the bearer access token without
 * verifying its signature. The JWT guard has already verified the token
 * by the time this runs (it sits behind @UseGuards(JwtAuthGuard)), so
 * a decode is sufficient and avoids re-paying the verify cost.
 */
function decodeAccessTokenClaims(req: Request): { jti: string | null; exp: number | null } {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return { jti: null, exp: null };
    const raw = auth.slice('Bearer '.length).trim();
    const parts = raw.split('.');
    if (parts.length !== 3) return { jti: null, exp: null };
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    const jti = typeof payload?.jti === 'string' ? payload.jti : null;
    const exp = typeof payload?.exp === 'number' ? payload.exp : null;
    return { jti, exp };
  } catch {
    return { jti: null, exp: null };
  }
}

// NOTE: ThrottlerGuard is applied per-method on the 8 unauthenticated
// auth endpoints below. The other (JWT-guarded) endpoints in this
// controller are deliberately NOT throttled — they require a valid
// session, so brute-force is irrelevant.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ThrottleOnly('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, ctxOf(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, ctxOf(req));
  }

  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('mfa')
  async verifyMfa(@Body() dto: VerifyMfaDto, @Req() req: Request) {
    return this.authService.verifyMfa(dto, ctxOf(req));
  }

  @Post('verify-recovery')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('recovery')
  async verifyRecovery(@Body() dto: VerifyRecoveryDto, @Req() req: Request) {
    return this.authService.verifyRecoveryCode(dto.email, dto.recovery_code, ctxOf(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('refresh')
  async refreshToken(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshToken(dto.refresh_token, ctxOf(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser('id') userId: string,
    @Body() body: { refresh_token?: string },
    @Req() req: Request,
  ) {
    // Phase 4.2 — extract jti + exp from the access token so the
    // service can add it to the Redis blacklist for its remaining TTL.
    // Decode-only (no verify) is safe: JwtAuthGuard already verified
    // the signature, and we only read jti/exp claims.
    const { jti, exp } = decodeAccessTokenClaims(req);
    return this.authService.logout(userId, {
      ip: ctxOf(req).ip,
      refreshToken: body?.refresh_token ?? null,
      accessJti: jti,
      accessExp: exp,
    });
  }

  @Post('accept-invitation')
  @ThrottleOnly('invitation')
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    return this.authService.acceptInvitation(dto, ctxOf(req));
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('forgot')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ThrottleOnly('reset')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException(
        'New password and confirm password do not match',
      );
    }
    return this.authService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Put('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(
    @CurrentUser('id') userId: string,
    @Body() body: CompleteOnboardingDto,
  ) {
    await this.authService.completeOnboarding(userId, body.level);
    return { message: 'Onboarding completed' };
  }

  // ─── MFA Settings Endpoints ───────────────────────────────────

  @Get('mfa/status')
  @UseGuards(JwtAuthGuard)
  async getMfaStatus(@CurrentUser('id') userId: string) {
    return this.authService.getMfaStatus(userId);
  }

  @Post('mfa/setup/totp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setupMfaTotp(@CurrentUser('id') userId: string) {
    return this.authService.setupMfaTotp(userId);
  }

  @Post('mfa/enable/totp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async enableMfaTotp(
    @CurrentUser('id') userId: string,
    @Body() dto: EnableMfaTotpDto,
  ) {
    return this.authService.enableMfaTotp(userId, dto.totp_code);
  }

  @Post('mfa/enable/email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async enableMfaEmail(@CurrentUser('id') userId: string) {
    return this.authService.enableMfaEmail(userId);
  }

  @Delete('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disableMfa(
    @CurrentUser('id') userId: string,
    @Body() dto: DisableMfaDto,
  ) {
    return this.authService.disableMfa(userId, dto.password);
  }
}
