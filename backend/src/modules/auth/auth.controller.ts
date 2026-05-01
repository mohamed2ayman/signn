import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

import { AuthService } from './auth.service';
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
} from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function ctxOf(req: Request) {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  return {
    ip: first || req.ip || req.socket?.remoteAddress || null,
    user_agent: (req.headers['user-agent'] as string) ?? null,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, ctxOf(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, ctxOf(req));
  }

  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(@Body() dto: VerifyMfaDto, @Req() req: Request) {
    return this.authService.verifyMfa(dto, ctxOf(req));
  }

  @Post('verify-recovery')
  @HttpCode(HttpStatus.OK)
  async verifyRecovery(@Body() dto: VerifyRecoveryDto, @Req() req: Request) {
    return this.authService.verifyRecoveryCode(dto.email, dto.recovery_code, ctxOf(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
    return this.authService.logout(userId, {
      ip: ctxOf(req).ip,
      refreshToken: body?.refresh_token ?? null,
    });
  }

  @Post('accept-invitation')
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Put('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(
    @CurrentUser('id') userId: string,
    @Body() body: { level: string },
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
