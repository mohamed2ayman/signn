import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Contract,
  Obligation,
  ObligationReminderEmailStatus,
  ObligationReminderLog,
  ObligationReminderType,
  ObligationStatus,
  Project,
  User,
} from '../../database/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { baseEmailLayout } from '../notifications/templates/base-layout';
import { ObligationTokenService } from '../compliance/services/obligation-token.service';

/**
 * Phase 3.4 enhanced obligation-reminder engine.
 *
 * `check-reminders` (daily at 8 AM):
 *   - Walks all PENDING/IN_PROGRESS obligations with a due_date
 *   - Computes days-until-due → maps to reminder type
 *   - Skips if (obligation, type) already exists in obligation_reminder_logs
 *   - Sends a tier-appropriate email with a one-click "Mark as Met" link
 *
 * `weekly-digest` (every Monday 8 AM):
 *   - Groups all upcoming + overdue obligations by user across ALL contracts
 *   - One digest email per user
 *   - Honours users.email_digest_opt_out
 *
 * Critical reminders (CRITICAL/HIGH severity tiers) cannot be opted out of.
 */
@Processor('obligation-reminders')
export class ObligationReminderProcessor {
  private readonly logger = new Logger(ObligationReminderProcessor.name);
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
    @InjectRepository(ObligationReminderLog)
    private readonly logRepo: Repository<ObligationReminderLog>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly dispatch: NotificationDispatchService,
    private readonly tokens: ObligationTokenService,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    this.backendUrl = this.config.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
  }

  @Process('check-reminders')
  async handleCheckReminders(_job: Job): Promise<void> {
    this.logger.log('Running daily obligation reminder check...');

    const obligations = await this.obligationRepository.find({
      where: {
        status: In([
          ObligationStatus.PENDING,
          ObligationStatus.IN_PROGRESS,
          ObligationStatus.OVERDUE,
        ]),
      },
      relations: ['contract', 'contract.creator'],
    });

    let sent = 0;
    let flippedOverdue = 0;
    const now = new Date();

    for (const o of obligations) {
      if (!o.due_date) continue;

      const days = Math.ceil(
        (new Date(o.due_date).getTime() - now.getTime()) / 86_400_000,
      );

      // Flip status to OVERDUE on first cron pass after the deadline
      if (days < 0 && o.status !== ObligationStatus.OVERDUE) {
        o.status = ObligationStatus.OVERDUE;
        await this.obligationRepository.save(o);
        flippedOverdue++;
      }

      const reminderType = this.tierFor(days, o.is_critical);
      if (!reminderType) continue;

      const recipient = o.contract?.creator;
      if (!recipient?.email) continue;

      const already = await this.logRepo.findOne({
        where: { obligation_id: o.id, reminder_type: reminderType },
      });
      if (already) continue;

      try {
        const { token } = this.tokens.issue(o.id, recipient.id);
        await this.dispatch.enqueueEmail({
          to: recipient.email,
          subject: this.subjectFor(reminderType, o, days),
          html: this.renderReminder({
            recipientName: recipient.first_name || recipient.email,
            obligation: o,
            daysUntilDue: days,
            tier: reminderType,
            markMetUrl: `${this.backendUrl}/api/v1/public/obligations/mark-met?token=${token}`,
            viewUrl: `${this.frontendUrl}/app/contracts/${o.contract_id}?tab=obligations&oid=${o.id}`,
          }),
          templateName: 'obligation_reminder_v2',
        });
        await this.logRepo.insert({
          obligation_id: o.id,
          reminder_type: reminderType,
          sent_to: recipient.email,
          email_status: ObligationReminderEmailStatus.SENT,
        });
        await this.obligationRepository.update(o.id, {
          last_reminder_sent_at: new Date(),
        });
        sent++;
      } catch (err) {
        this.logger.error(
          `Failed to send reminder for ${o.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reminder pass complete: ${sent} sent, ${flippedOverdue} flipped to OVERDUE`,
    );
  }

  /**
   * Weekly digest — groups every user's pending obligations into one
   * email. Critical/overdue items get their own bullet at the top.
   */
  @Process('weekly-digest')
  async handleWeeklyDigest(_job: Job): Promise<void> {
    this.logger.log('Running weekly obligations digest...');

    const obligations = await this.obligationRepository.find({
      where: {
        status: In([
          ObligationStatus.PENDING,
          ObligationStatus.IN_PROGRESS,
          ObligationStatus.OVERDUE,
        ]),
      },
      relations: ['contract', 'contract.creator', 'contract.project'],
    });

    // Group by recipient (contract creator)
    const byUser = new Map<string, Obligation[]>();
    for (const o of obligations) {
      const u = o.contract?.creator;
      if (!u) continue;
      const list = byUser.get(u.id) ?? [];
      list.push(o);
      byUser.set(u.id, list);
    }

    let sent = 0;
    for (const [userId, items] of byUser) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user || user.email_digest_opt_out) continue;

      // Filter to "next 30 days" + "overdue"
      const upcoming = items.filter((o) => {
        if (!o.due_date) return false;
        const days = Math.ceil(
          (new Date(o.due_date).getTime() - Date.now()) / 86_400_000,
        );
        return days <= 30;
      });
      if (upcoming.length === 0) continue;

      const projectName =
        upcoming[0].contract?.project?.name ?? 'your projects';
      try {
        await this.dispatch.enqueueEmail({
          to: user.email,
          subject: `[SIGN] Weekly Obligations Digest — ${projectName}`,
          html: this.renderDigest({
            recipientName: user.first_name || user.email,
            items: upcoming,
            viewBaseUrl: `${this.frontendUrl}/app/projects`,
          }),
          templateName: 'obligation_weekly_digest',
        });
        for (const o of upcoming) {
          await this.logRepo.insert({
            obligation_id: o.id,
            reminder_type: ObligationReminderType.WEEKLY_DIGEST,
            sent_to: user.email,
            email_status: ObligationReminderEmailStatus.SENT,
          });
        }
        sent++;
      } catch (err) {
        this.logger.error(
          `Failed to send weekly digest to ${user.email}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`Weekly digest complete: ${sent} users notified`);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private tierFor(
    daysUntilDue: number,
    _critical: boolean,
  ): ObligationReminderType | null {
    if (daysUntilDue < 0) return ObligationReminderType.OVERDUE;
    if (daysUntilDue === 0) return ObligationReminderType.DUE_TODAY;
    if (daysUntilDue === 1) return ObligationReminderType.DAYS_1;
    if (daysUntilDue <= 7) return ObligationReminderType.DAYS_7;
    if (daysUntilDue <= 14) return ObligationReminderType.DAYS_14;
    if (daysUntilDue <= 30) return ObligationReminderType.DAYS_30;
    return null;
  }

  private subjectFor(
    tier: ObligationReminderType,
    o: Obligation,
    days: number,
  ): string {
    const prefix =
      tier === ObligationReminderType.OVERDUE
        ? '[OVERDUE]'
        : tier === ObligationReminderType.DUE_TODAY
        ? '[Due Today]'
        : tier === ObligationReminderType.DAYS_1
        ? '[Tomorrow]'
        : tier === ObligationReminderType.DAYS_7
        ? '[7 days]'
        : tier === ObligationReminderType.DAYS_14
        ? '[14 days]'
        : '[30 days]';
    void days;
    const desc = o.description.length > 60 ? `${o.description.slice(0, 60)}…` : o.description;
    return `${prefix} ${desc}`;
  }

  private renderReminder(data: {
    recipientName: string;
    obligation: Obligation;
    daysUntilDue: number;
    tier: ObligationReminderType;
    markMetUrl: string;
    viewUrl: string;
  }): string {
    const o = data.obligation;
    const due = o.due_date ? new Date(o.due_date).toDateString() : 'TBD';
    const banner = this.tierBanner(data.tier);
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">
        Obligation Reminder
      </h1>
      ${banner}
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        Hi ${data.recipientName}, this is a reminder about an obligation${o.is_critical ? ' (CRITICAL)' : ''}.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#F8FAFF; border-radius:10px; margin:20px 0;">
        <tr><td style="padding:10px 16px;">
          <span style="font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Obligation</span><br/>
          <span style="font-size:14px; color:#0F1729;">${o.description}</span>
        </td></tr>
        ${o.clause_ref ? `<tr><td style="padding:10px 16px;"><span style="font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Clause</span><br/><span style="font-size:14px; color:#0F1729; font-weight:600;">${o.clause_ref}</span></td></tr>` : ''}
        <tr><td style="padding:10px 16px;">
          <span style="font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Due Date</span><br/>
          <span style="font-size:14px; color:#0F1729; font-weight:600;">${due}</span>
        </td></tr>
        ${o.timeframe_description ? `<tr><td style="padding:10px 16px;"><span style="font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Timeframe</span><br/><span style="font-size:14px; color:#0F1729;">${o.timeframe_description}</span></td></tr>` : ''}
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;"><tr>
        <td><a href="${data.markMetUrl}" style="display:inline-block; padding:12px 24px; margin-right:8px; background:#059669; color:#fff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">✓ Mark as Met</a></td>
        <td><a href="${data.viewUrl}" style="display:inline-block; padding:12px 24px; background:#4F6EF7; color:#fff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">View in SIGN</a></td>
      </tr></table>
    `;
    return baseEmailLayout(content, {
      preheader: `${data.tier.replace('_', ' ').toLowerCase()} reminder for ${o.description.slice(0, 60)}`,
    });
  }

  private renderDigest(data: {
    recipientName: string;
    items: Obligation[];
    viewBaseUrl: string;
  }): string {
    const overdue = data.items.filter(
      (o) => o.status === ObligationStatus.OVERDUE,
    );
    const upcoming = data.items
      .filter((o) => o.status !== ObligationStatus.OVERDUE)
      .sort(
        (a, b) =>
          (a.due_date ? +new Date(a.due_date) : 0) -
          (b.due_date ? +new Date(b.due_date) : 0),
      );
    const overdueRows = overdue
      .map(
        (o) =>
          `<tr><td style="padding:8px 16px; font-size:13px; color:#991B1B;">⚠ ${o.description.slice(0, 80)} — due ${o.due_date ? new Date(o.due_date).toDateString() : 'TBD'}</td></tr>`,
      )
      .join('');
    const upcomingRows = upcoming
      .map(
        (o) =>
          `<tr><td style="padding:6px 16px; font-size:13px; color:#0F1729;">${o.is_critical ? '<strong style="color:#DC2626">[CRITICAL]</strong> ' : ''}${o.description.slice(0, 80)} — due ${o.due_date ? new Date(o.due_date).toDateString() : 'TBD'}</td></tr>`,
      )
      .join('');
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">
        Weekly Obligations Digest
      </h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        Hi ${data.recipientName}, here is your weekly summary of obligations across your projects.
      </p>
      ${overdue.length > 0 ? `<h3 style="color:#991B1B; font-size:14px; margin-top:24px;">Overdue (${overdue.length})</h3><table style="width:100%; background:#FEF2F2; border-radius:8px;">${overdueRows}</table>` : ''}
      ${upcoming.length > 0 ? `<h3 style="color:#0F1729; font-size:14px; margin-top:24px;">Upcoming in the next 30 days (${upcoming.length})</h3><table style="width:100%; background:#F8FAFF; border-radius:8px;">${upcomingRows}</table>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;"><tr><td>
        <a href="${data.viewBaseUrl}" style="display:inline-block; padding:12px 24px; background:#4F6EF7; color:#fff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">Open SIGN Dashboard</a>
      </td></tr></table>
      <p style="margin:20px 0 0; font-size:11px; color:#9CA3AF;">
        You can opt out of weekly digests in Profile &amp; Security. Critical reminders cannot be disabled.
      </p>
    `;
    return baseEmailLayout(content, {
      preheader: `${data.items.length} obligations need your attention`,
    });
  }

  private tierBanner(tier: ObligationReminderType): string {
    if (tier === ObligationReminderType.OVERDUE) {
      return `<div style="background:#FEF2F2; border-left:3px solid #DC2626; padding:10px 16px; margin:12px 0; color:#991B1B; font-size:13px; font-weight:600;">⚠ This obligation is OVERDUE</div>`;
    }
    if (tier === ObligationReminderType.DUE_TODAY) {
      return `<div style="background:#FEF2F2; border-left:3px solid #DC2626; padding:10px 16px; margin:12px 0; color:#991B1B; font-size:13px; font-weight:600;">Action required today</div>`;
    }
    if (tier === ObligationReminderType.DAYS_1) {
      return `<div style="background:#FFFBEB; border-left:3px solid #D97706; padding:10px 16px; margin:12px 0; color:#92400E; font-size:13px; font-weight:600;">Due tomorrow</div>`;
    }
    if (tier === ObligationReminderType.DAYS_7) {
      return `<div style="background:#FFFBEB; border-left:3px solid #D97706; padding:10px 16px; margin:12px 0; color:#92400E; font-size:13px; font-weight:600;">Due in 7 days</div>`;
    }
    return '';
  }
}
