import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../../../database/entities';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { SessionService } from './session.service';
import { SecurityEventService } from './security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import { baseEmailLayout } from '../../notifications/templates/base-layout';

const RECOVERY_CODE_COUNT = 8;
const BCRYPT_SALT_ROUNDS = 10;

export interface ResetMfaResult {
  user_id: string;
  email: string;
  recovery_codes: string[];
  sessions_revoked: number;
}

/**
 * Admin-side MFA helpers — reset a user's MFA (for lockout/recovery)
 * and nudge non-MFA users to enable it.
 *
 * "Reset MFA" = clear secret + recovery codes, generate 8 fresh
 * recovery codes (returned ONCE in response and emailed to the user),
 * revoke all active sessions, audit the action.
 */
@Injectable()
export class MfaAdminService {
  private readonly logger = new Logger(MfaAdminService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sessionService: SessionService,
    private readonly securityEvents: SecurityEventService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async resetMfa(input: {
    targetUserId: string;
    actorUserId: string;
    actorIp: string | null;
  }): Promise<ResetMfaResult> {
    const target = await this.userRepo.findOne({
      where: { id: input.targetUserId },
    });
    if (!target) throw new NotFoundException('User not found');

    const { plain, hashed } = await this.generateRecoveryCodes();

    await this.userRepo.update(target.id, {
      mfa_enabled: false,
      mfa_method: null as unknown as string,
      mfa_secret: null as unknown as string,
      mfa_recovery_codes: hashed,
    });

    const revoked = await this.sessionService.revokeAllForUser(target.id);

    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.MFA_RESET,
      user_id: target.id,
      actor_id: input.actorUserId,
      ip_address: input.actorIp,
      metadata: { sessions_revoked: revoked },
    });

    // Email the user with recovery codes + setup link
    try {
      await this.dispatch.enqueueEmail({
        to: target.email,
        subject: 'Your MFA has been reset — set it up again',
        html: this.renderResetEmail({
          recipientName: target.first_name || target.email,
          recoveryCodes: plain,
        }),
        templateName: 'mfa_reset',
      });
    } catch (e) {
      this.logger.error(
        `Failed to send MFA reset email to ${target.email}: ${(e as Error).message}`,
      );
    }

    return {
      user_id: target.id,
      email: target.email,
      recovery_codes: plain,
      sessions_revoked: revoked,
    };
  }

  /** Send a "please enable MFA" reminder email. No DB mutation. */
  async sendReminder(input: {
    targetUserId: string;
    actorUserId: string;
  }): Promise<{ sent: boolean }> {
    const target = await this.userRepo.findOne({
      where: { id: input.targetUserId },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.mfa_enabled) {
      throw new BadRequestException('User already has MFA enabled');
    }

    await this.dispatch.enqueueEmail({
      to: target.email,
      subject: 'Please enable MFA on your Sign account',
      html: this.renderReminderEmail({
        recipientName: target.first_name || target.email,
      }),
      templateName: 'mfa_reminder',
    });

    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.ADMIN_ACTION,
      user_id: target.id,
      actor_id: input.actorUserId,
      metadata: { action: 'mfa_reminder_sent' },
    });

    return { sent: true };
  }

  // ─── Helpers ──────────────────────────────────────────

  private async generateRecoveryCodes(): Promise<{
    plain: string[];
    hashed: string[];
  }> {
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code =
        crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4) +
        '-' +
        crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
      plain.push(code);
      hashed.push(await bcrypt.hash(code, BCRYPT_SALT_ROUNDS));
    }
    return { plain, hashed };
  }

  private renderResetEmail(data: {
    recipientName: string;
    recoveryCodes: string[];
  }): string {
    const codeRows = data.recoveryCodes
      .map(
        (c) =>
          `<div style="font-family: 'JetBrains Mono', monospace; padding:8px 14px; background:#F8FAFF; border-radius:6px; margin:4px 0; font-size:14px; letter-spacing:1px; color:#0F1729;">${c}</div>`,
      )
      .join('');
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your MFA Has Been Reset</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">Hi ${data.recipientName}, an administrator reset multi-factor authentication on your account. All active sessions have been signed out for your safety.</p>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">Save these recovery codes somewhere safe — each one can be used once if you lose access to your authenticator:</p>
      ${codeRows}
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">If you didn't request this, contact your administrator immediately.</p>
    `;
    return baseEmailLayout(content, { preheader: 'Your MFA was reset by an administrator' });
  }

  private renderReminderEmail(data: { recipientName: string }): string {
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Secure Your Account</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">Hi ${data.recipientName}, your Sign account doesn't have multi-factor authentication enabled yet.</p>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">MFA is the single most effective way to protect your contracts and signing keys from unauthorized access. Set it up in under a minute from your profile page.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/settings/security"
             style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">Enable MFA Now</a>
        </td></tr>
      </table>
    `;
    return baseEmailLayout(content, { preheader: 'Enable MFA to protect your account' });
  }
}
