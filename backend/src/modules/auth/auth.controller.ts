import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.authService.verifyMfa(dto);
  }

  @Post('verify-recovery')
  @HttpCode(HttpStatus.OK)
  async verifyRecovery(@Body() dto: VerifyRecoveryDto) {
    return this.authService.verifyRecoveryCode(dto.email, dto.recovery_code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
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
