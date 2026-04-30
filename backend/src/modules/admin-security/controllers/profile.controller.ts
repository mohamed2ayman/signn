import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { User } from '../../../database/entities';
import { SessionService } from '../services/session.service';
import { PasswordPolicyService } from '../services/password-policy.service';
import { SecurityEventService } from '../services/security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import {
  ChangePasswordDto,
  UpdateProfileDto,
} from '../dto/admin-security.dto';
import { GdprExportService } from '../services/gdpr-export.service';

/**
 * /me — endpoints scoped to the authenticated user themselves
 * (not admin-only). These power the in-app Profile page and are
 * available to every logged-in user regardless of role.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordPolicyService,
    private readonly securityEvents: SecurityEventService,
    private readonly gdpr: GdprExportService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: User) {
    const fresh = await this.userRepo.findOne({ where: { id: user.id } });
    if (!fresh) throw new BadRequestException('User not found');
    const { password_hash, refresh_token_hash, mfa_secret, mfa_recovery_codes, mfa_totp_secret, ...safe } = fresh as any;
    return safe;
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    await this.userRepo.update(user.id, dto);
    return { ok: true };
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const fresh = await this.userRepo.findOne({ where: { id: user.id } });
    if (!fresh) throw new BadRequestException('User not found');

    const ok = await bcrypt.compare(dto.current_password, fresh.password_hash);
    if (!ok) throw new BadRequestException('Current password is incorrect');

    await this.passwords.assertComplexity(dto.new_password);
    await this.passwords.assertNotReused(user.id, dto.new_password);

    const oldHash = fresh.password_hash;
    const newHash = await this.passwords.hash(dto.new_password);

    await this.userRepo.update(user.id, {
      password_hash: newHash,
      password_changed_at: new Date(),
    });
    await this.passwords.appendToHistory(user.id, oldHash);

    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.PASSWORD_CHANGED,
      actor_id: user.id,
      user_id: user.id,
      ip_address: this.ipOf(req),
    });

    return { ok: true };
  }

  // ─── Sessions ─────────────────────────────────────────

  @Get('sessions')
  async listSessions(@CurrentUser() user: User) {
    return this.sessions.listActive(user.id);
  }

  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const session = await this.sessions.revokeOne(id);
    if (session.user_id !== user.id) {
      throw new BadRequestException('Not your session');
    }
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.SESSION_REVOKED,
      actor_id: user.id,
      user_id: user.id,
      ip_address: this.ipOf(req),
      metadata: { session_id: id },
    });
    return { ok: true };
  }

  @Delete('sessions')
  async revokeAll(@CurrentUser() user: User, @Req() req: Request) {
    const count = await this.sessions.revokeAllForUser(user.id);
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.SESSION_REVOKED,
      actor_id: user.id,
      user_id: user.id,
      ip_address: this.ipOf(req),
      metadata: { revoked: count, scope: 'all' },
    });
    return { revoked: count };
  }

  // ─── GDPR self-service export ─────────────────────────

  @Post('gdpr/export')
  async exportMyData(@CurrentUser() user: User, @Req() req: Request) {
    return this.gdpr.exportNow({
      userId: user.id,
      actorId: user.id,
      ipAddress: this.ipOf(req),
    });
  }

  private ipOf(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
    return first || req.ip || req.socket?.remoteAddress || null;
  }
}
