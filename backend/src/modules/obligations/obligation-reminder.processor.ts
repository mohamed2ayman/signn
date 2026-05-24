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
 * Phase 3.4 / Phase 7.1 enhanced obligation-reminder engine.
 *
 * `check-reminders` (daily at 8 AM):
 *   - Walks all PENDING/IN_PROGRESS/OVERDUE obligations with a due_date
 *   - Computes days-until-due → maps to reminder type using the obligation's
 *     custom reminder_schedule (Phase 7.1) instead of hardcoded tiers
 *   - Skips if (obligation, type) already exists in obligation_reminder_logs
 *   - Sends email reminders to each assignee (Phase 7.1), falling back to
 *     the contract creator when no assignees are set
 *   - For OVERDUE obligations: additionally notifies the escalation contact
 *     (escalation_contact_user_id or escalation_contact_email on the contract)
 *   - Creates an in-app notification for every platform-user recipient (Phase 7.1)
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

    // Phase 7.1: load assignees + their user, escalation_contact_user on contract
    const obligations = await this.obligationRepository.find({
      where: {
        status: In([
          ObligationStatus.PENDING,
          ObligationStatus.IN_PROGRESS,
          ObligationStatus.OVERDUE,
        ]),
      },
      relations: [
        'contract',
        'contract.creator',
        'contract.escalation_contact_user',
        'assignees',
        'assignees.user',
      ],
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

      // Phase 7.1: use per-obligation reminder_schedule instead of hardcoded tiers
      const reminderType = this.scheduledTierFor(days, o.reminder_schedule);
      if (!reminderType) continue;

      const already = await this.logRepo.findOne({
        where: { obligation_id: o.id, reminder_type: reminderType },
      });
      if (already) continue;

      // Phase 7.1: recipients = assignees first, fallback to contract creator
      const primaryRecipients = this.primaryRecipientsFor(o);
      if (primaryRecipients.length === 0) continue;

      let anySent = false;

      for (const recipient of primaryRecipients) {
        if (!recipient.email) continue;
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

          // Phase 7.1: in-app notification for platform users
          await this.dispatch.dispatchObligationReminder({
            obligationId: o.id,
            obligationDescription: o.description,
            userId: recipient.id,
            tier: reminderType,
            contractName: o.contract?.name ?? '',
          });

          anySent = true;
        } catch (err) {
          this.logger.error(
            `Failed to send reminder for obligation ${o.id} to ${recipient.email}: ${(err as Error).message}`,
          );
        }
      }

      // Phase 7.1: escalation for OVERDUE obligations
      if (reminderType === ObligationReminderType.OVERDUE && o.contract) {
        await this.sendEscalation(o, days);
      }

      // Write dedup log only after at least one send succeeded
      if (anySent) {
        await this.logRepo.insert({
          obligation_id: o.id,
          reminder_type: reminderType,
          sent_to: primaryRecipients.map((u) => u.email).join(', '),
          email_status: ObligationReminderEmailStatus.SENT,
        });
        await this.obligationRepository.update(o.id, {
          last_reminder_sent_at: new Date(),
        });
        sent++;
      }
    }

    this.logger.log(
      `Reminder pass complete: ${sent} sent, ${flippedOverdue} flipped to OVERDUE`,
    );
  }

  /**
   * Weekly digest — groups every user's pending obligations into one
   * email. Critical/overdue items get their own bullet at the top.
   * Phase 7.1: includes both assignees AND contract creators.
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
      relations: [
        'contract',
        'contract.creator',
        'contract.project',
        'assignees',
        'assignees.user',
      ],
    });

    // Collect recipients: assignees if set, otherwise contract creator
    const byUser = new Map<string, Obligation[]>();
    for (const o of obligations) {
      const recipients = this.primaryRecipientsFor(o);
      for (const u of recipients) {
        if (!u?.id) continue;
        const list = byUser.get(u.id) ?? [];
        list.push(o);
        byUser.set(u.id, list);
      }
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

  // ─── Phase 7.1 helpers ────────────────────────────────────────────────────

  /**
   * Returns the primary recipient list for an obligation.
   * Prefers explicit assignees; falls back to contract creator.
   */
  private primaryRecipientsFor(o: Obligation): User[] {
    if (o.assignees && o.assignees.length > 0) {
      return o.assignees
        .map((a) => a.user)
        .filter((u): u is User => !!u?.email);
    }
    const creator = o.contract?.creator;
    if (creator?.email) return [creator];
    return [];
  }

  /**
   * Send escalation notification for an OVERDUE obligation.
   * Priority: escalation_contact_user (platform user, in-app + email)
   *         → escalation_contact_email (external, email only)
   * The primary recipients already received the normal OVERDUE reminder above.
   */
  private async sendEscalation(o: Obligation, days: number): Promise<void> {
    const contract = o.contract;
    if (!contract) return;

    const escalationUser = contract.escalation_contact_user;
    const escalationEmail = contract.escalation_contact_email;

    if (escalationUser?.email) {
      // Platform user — email + in-app
      try {
        await this.dispatch.enqueueEmail({
          to: escalationUser.email,
          subject: this.subjectFor(ObligationReminderType.OVERDUE, o, days),
          html: this.renderReminder({
            recipientName: escalationUser.first_name || escalationUser.email,
            obligation: o,
            daysUntilDue: days,
            tier: ObligationReminderType.OVERDUE,
            markMetUrl: `${this.backendUrl}/api/v1/public/obligations/mark-met?token=${this.tokens.issue(o.id, escalationUser.id).token}`,
            viewUrl: `${this.frontendUrl}/app/contracts/${o.contract_id}?tab=obligations&oid=${o.id}`,
          }),
          templateName: 'obligation_reminder_v2',
        });
        await this.dispatch.dispatchObligationReminder({
          obligationId: o.id,
          obligationDescription: o.description,
          userId: escalationUser.id,
          tier: ObligationReminderType.OVERDUE,
          contractName: contract.name ?? '',
        });
      } catch (err) {
        this.logger.error(
          `Failed to send escalation for obligation ${o.id} to escalation user ${escalationUser.email}: ${(err as Error).message}`,
        );
      }
    } else if (escalationEmail) {
      // External email-only escalation contact — no in-app notification
      try {
        await this.dispatch.enqueueEmail({
          to: escalationEmail,
          subject: this.subjectFor(ObligationReminderType.OVERDUE, o, days),
          html: this.renderReminder({
            recipientName: escalationEmail,
            obligation: o,
            daysUntilDue: days,
            tier: ObligationReminderType.OVERDUE,
            // External contact cannot mark as met — omit token link
            markMetUrl: `${this.frontendUrl}/app/contracts/${o.contract_id}?tab=obligations&oid=${o.id}`,
            viewUrl: `${this.frontendUrl}/app/contracts/${o.contract_id}?tab=obligations&oid=${o.id}`,
          }),
          templateName: 'obligation_reminder_v2',
        });
      } catch (err) {
        this.logger.error(
          `Failed to send escalation for obligation ${o.id} to external email ${escalationEmail}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Tier mapping ─────────────────────────────────────────────────────────

  /**
   * Maps days-until-due to a reminder tier, respecting the obligation's
   * custom `reminder_schedule` array (Phase 7.1).
   *
   * Logic:
   *   - days < 0  → OVERDUE  (always, regardless of schedule)
   *   - days = 0  → DUE_TODAY (always)
   *   - Find all schedule thresholds where days <= threshold; pick the
   *     smallest one (tightest matching window) and map it to a tier.
   *
   * Fallback: if schedule is empty/null, defaults to [30, 14, 7, 1].
   */
  private scheduledTierFor(
    daysUntilDue: number,
    schedule: number[] | null | undefined,
  ): ObligationReminderType | null {
    if (daysUntilDue < 0) return ObligationReminderType.OVERDUE;
    if (daysUntilDue === 0) return ObligationReminderType.DUE_TODAY;

    const effective = schedule?.length ? schedule : [30, 14, 7, 1];
    // Find thresholds whose window we're currently inside (days <= threshold)
    const matching = effective
      .filter((t) => t > 0 && daysUntilDue <= t)
      .sort((a, b) => a - b); // ascending → smallest first (tightest window)

    if (matching.length === 0) return null;
    return this.thresholdToTier(matching[0]);
  }

  /**
   * Maps a numeric day threshold to the nearest standard
   * ObligationReminderType enum value.
   */
  private thresholdToTier(threshold: number): ObligationReminderType {
    if (threshold >= 28) return ObligationReminderType.DAYS_30;
    if (threshold >= 12) return ObligationReminderType.DAYS_14;
    if (threshold >= 5) return ObligationReminderType.DAYS_7;
    return ObligationReminderType.DAYS_1;
  }

  // ─── Email rendering ──────────────────────────────────────────────────────

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
    const desc =
      o.description.length > 60
        ? `${o.description.slice(0, 60)}…`
        : o.description;
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
