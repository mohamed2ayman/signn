import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../../database/entities';
import { SecurityPolicyService } from '../services/security-policy.service';
import { SessionService } from '../services/session.service';
import { MfaAdminService } from '../services/mfa-admin.service';
import { IpFilterService } from '../services/ip-filter.service';
import { SecurityScoreService } from '../services/security-score.service';
import { SecurityEventService } from '../services/security-event.service';
import { SecurityAuditLogService } from '../services/security-audit-log.service';
import { AdminActivityLogService } from '../services/admin-activity-log.service';
import { GdprExportService } from '../services/gdpr-export.service';
import { KnownDeviceService } from '../services/known-device.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import {
  AuditLogQueryDto,
  GdprDeleteDto,
  UpdateSecurityPolicyDto,
} from '../dto/admin-security.dto';

/**
 * SYSTEM_ADMIN-only endpoints for security management:
 *   • /admin/security/policy           — read & update SecurityPolicy
 *   • /admin/security/score            — composite security score
 *   • /admin/security/blocked-ips      — recent blocked attempts
 *   • /admin/security/audit            — security.* audit feed
 *   • /admin/security/activity         — broader admin activity feed
 *   • /admin/security/sessions/active-suspicious — banner data
 *
 *   • /admin/users/:id/mfa/reset       — reset target user's MFA
 *   • /admin/users/:id/mfa/remind      — send MFA reminder
 *   • /admin/users/:id/sessions        — list/revoke target's sessions
 *   • /admin/users/:id/devices         — list/clear known devices
 *   • /admin/users/:id/gdpr/export     — admin-initiated export
 *   • /admin/users/:id/gdpr/delete     — anonymize-delete
 */
@Controller('admin/security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminSecurityController {
  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly ipFilter: IpFilterService,
    private readonly score: SecurityScoreService,
    private readonly securityEvents: SecurityEventService,
    private readonly securityAudit: SecurityAuditLogService,
    private readonly adminActivity: AdminActivityLogService,
  ) {}

  // ─── Policy ───────────────────────────────────────────

  @Get('policy')
  async getPolicy() {
    return this.policy.get();
  }

  @Patch('policy')
  async updatePolicy(
    @CurrentUser() user: User,
    @Body() dto: UpdateSecurityPolicyDto,
    @Req() req: Request,
  ) {
    const { before, after, changedFields } = await this.policy.update(dto, user.id);
    if (changedFields.length > 0) {
      await this.securityEvents.record({
        type: SECURITY_EVENT_TYPES.SETTINGS_CHANGED,
        actor_id: user.id,
        ip_address: ipOf(req),
        before: before as unknown as Record<string, unknown>,
        metadata: {
          changed: changedFields,
          after: after as unknown as Record<string, unknown>,
        },
        entity_type: 'security_policy',
        entity_id: 'global',
      });
    }
    return after;
  }

  // ─── Score & monitoring ───────────────────────────────

  @Get('score')
  async getScore() {
    return this.score.compute();
  }

  @Get('blocked-ips')
  async listBlocked(@Query('limit') limit?: string) {
    return this.ipFilter.listRecentBlocked(limit ? Number(limit) : 20);
  }

  @Get('sessions/active-suspicious')
  async listSuspicious() {
    const sessions = await this.sessions.listActiveSuspicious(20);
    const count = await this.sessions.countActiveSuspicious();
    return { count, sessions };
  }

  // ─── Audit + activity feeds ──────────────────────────

  @Get('audit')
  async listSecurityAudit(@Query() q: AuditLogQueryDto) {
    return this.securityAudit.list({
      target_user_id: q.target_user_id,
      action: q.action,
      search: q.search,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit,
      offset: q.offset,
    });
  }

  @Get('activity')
  async listAdminActivity(@Query() q: AuditLogQueryDto) {
    return this.adminActivity.list({
      actor_id: q.actor_id,
      action: q.action,
      entity_type: q.entity_type,
      search: q.search,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit,
      offset: q.offset,
    });
  }

  @Get('activity/actions')
  async listKnownActions() {
    return this.adminActivity.listKnownActions();
  }
}

/**
 * Per-user admin operations. Path under `/admin/users/:id/...` so it
 * sits naturally next to the existing user management surface.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminUserSecurityController {
  constructor(
    private readonly mfaAdmin: MfaAdminService,
    private readonly sessions: SessionService,
    private readonly devices: KnownDeviceService,
    private readonly gdpr: GdprExportService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  @Post(':id/mfa/reset')
  async resetMfa(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.mfaAdmin.resetMfa({
      targetUserId: id,
      actorUserId: actor.id,
      actorIp: ipOf(req),
    });
  }

  @Post(':id/mfa/remind')
  async remindMfa(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.mfaAdmin.sendReminder({
      targetUserId: id,
      actorUserId: actor.id,
    });
  }

  @Get(':id/sessions')
  async listSessions(@Param('id') id: string) {
    return this.sessions.listAll(id);
  }

  @Delete(':id/sessions/:sessionId')
  async revokeSession(
    @CurrentUser() actor: User,
    @Param('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ) {
    await this.sessions.revokeOne(sessionId);
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.SESSION_REVOKED,
      actor_id: actor.id,
      user_id: userId,
      ip_address: ipOf(req),
      metadata: { session_id: sessionId, by_admin: true },
    });
    return { ok: true };
  }

  @Delete(':id/sessions')
  async revokeAllSessions(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const count = await this.sessions.revokeAllForUser(id);
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.SESSION_REVOKED,
      actor_id: actor.id,
      user_id: id,
      ip_address: ipOf(req),
      metadata: { revoked: count, scope: 'all', by_admin: true },
    });
    return { revoked: count };
  }

  @Delete(':id/devices')
  async clearDevices(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const count = await this.devices.deleteAllForUser(id);
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.ADMIN_ACTION,
      actor_id: actor.id,
      user_id: id,
      ip_address: ipOf(req),
      metadata: { cleared_devices: count },
    });
    return { cleared: count };
  }

  @Post(':id/gdpr/export')
  async exportData(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.gdpr.exportNow({
      userId: id,
      actorId: actor.id,
      ipAddress: ipOf(req),
    });
  }

  @Post(':id/gdpr/delete')
  async anonymize(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: GdprDeleteDto,
    @Req() req: Request,
  ) {
    return this.gdpr.anonymizeDelete({
      userId: id,
      actorId: actor.id,
      ipAddress: ipOf(req),
      confirmation: dto.confirmation,
    });
  }
}

function ipOf(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || null;
}
