import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ClauseRedline,
  Contract,
  NotificationType,
  RedlineNotificationBatch,
  RedlineNotificationEventClass,
  User,
} from '../../../database/entities';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { redlineNotificationEmail } from '../../notifications/templates';
import { ManagingOrGuestCaller } from '../../contracts/services/contract-access.service';
import { redlineAuthorLabel } from '../utils/redline-author-label.util';
import {
  RedlineEmailLang,
  resolveRecipientLang,
} from '../utils/recipient-language.util';
import {
  RedlineCopyVars,
  RedlineNotificationVariant,
  redlineNotificationCopy,
} from '../utils/redline-notification-copy';

/**
 * The four notifying events. `withdraw` deliberately notifies nobody.
 *
 * `accepted` splits on the wire into two COPY variants — see
 * `RedlineNotifiableEvent`'s `hostEdited` flag on notifyRedlineEvent: an accept
 * that substituted the host's wording must NOT tell the counterparty their own
 * wording went live.
 */
export type RedlineNotifiableEvent =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'countered';

/** A resolved notification target. `userId` null ⇒ no user row ⇒ EMAIL-only. */
interface RedlineRecipient {
  userId: string | null;
  email: string | null;
  preferredLanguage: string | null;
}

/**
 * 7.19 Slice 4 — redline notifications.
 *
 * ══ THE ONE RULE THIS SERVICE EXISTS TO ENFORCE ══
 * Notifications are POST-COMMIT and BEST-EFFORT. `notifyRedlineEvent` NEVER
 * throws: every path is wrapped, failures are logged and swallowed. A redline
 * decision is a legal act; an unreachable SMTP server, a Redis blip, or a
 * malformed template must never roll back a committed accept or turn a valid
 * 200 into a 500. This mirrors `notifyManagingOnUpload` (lesson #114) and the
 * `dispatchObligationReminder` "never throw from a background dispatcher"
 * posture — and it is why every call site can safely `await` this.
 *
 * ══ RECIPIENT — always the OTHER party, never the actor ══
 *   proposed                     → the HOST (contract.creator)
 *   accepted / rejected / countered → the COUNTERPARTY (redline.author_user_id)
 * A self-notification is suppressed by an explicit id comparison, so a host
 * countering their own proposal (or any future same-user path) stays silent.
 *
 * ══ CHANNEL — derived from data, never from persona ══
 * `userId` present → BOTH (in-app + email); absent → EMAIL only. This is a
 * STRUCTURAL consequence, not a policy branch: `notifications.user_id` is NOT
 * NULL, so an in-app row is impossible without a user row. There is deliberately
 * NO `account_type` branching — a future org-less guest recipient degrades
 * automatically.
 *
 * ══ NO CROSS-ORG LEAK ══
 * The only actor detail rendered is the display name from the SHARED
 * `redlineAuthorLabel` projection (name + TEAM/GUEST, keyed on HOST-org
 * membership) — the same function the redline LIST response uses. Emails,
 * roles, org names and every UUID stay out of the notification. Digests carry
 * no actor detail at all.
 *
 * ══ ORG DERIVATION ══
 * `contract → project → organization_id`, never the caller's `organization_id`
 * (standing invariant 3). It is used ONLY to decide the TEAM/GUEST label.
 */
@Injectable()
export class RedlineNotificationService {
  private readonly logger = new Logger(RedlineNotificationService.name);

  /**
   * Debounce window. A burst of events to the SAME recipient about the SAME
   * contract and event class inside this window collapses into ONE digest.
   * 3 minutes: long enough to absorb a reviewer working through a contract
   * clause-by-clause, short enough that a counterparty is not left waiting.
   */
  static readonly DIGEST_WINDOW_MS = 3 * 60 * 1000;

  constructor(
    private readonly dispatch: NotificationDispatchService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RedlineNotificationBatch)
    private readonly batchRepo: Repository<RedlineNotificationBatch>,
    private readonly config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // PUBLIC — the single entry point every redline call site uses
  // ────────────────────────────────────────────────────────────────────────
  /**
   * Fire the notification for one redline event. MUST be called AFTER the
   * redline transaction has committed. Never throws.
   */
  async notifyRedlineEvent(input: {
    event: RedlineNotifiableEvent;
    contract: Contract;
    redline: Pick<ClauseRedline, 'id' | 'author_user_id' | 'contract_clause_id'>;
    actor: ManagingOrGuestCaller;
    /**
     * `accept` only: the host substituted their own wording
     * (`dto.editedContent`), so the promoted clause is NOT what the
     * counterparty proposed. Selects the honest `accepted_edited` copy.
     */
    hostEdited?: boolean;
  }): Promise<void> {
    try {
      await this.deliver(input);
    } catch (err) {
      // Swallow — a notification failure must never surface to the caller or
      // undo committed redline state.
      // Ops-search signal, matching the metering consumer convention:
      // `redline.notify.{proposed|accepted|rejected|countered}_error`.
      this.logger.error(
        `redline.notify.${input.event}_error ` +
          `contract=${input.contract?.id} redline=${input.redline?.id}: ` +
          `${(err as Error)?.message}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // INTERNAL
  // ────────────────────────────────────────────────────────────────────────
  private async deliver(input: {
    event: RedlineNotifiableEvent;
    contract: Contract;
    redline: Pick<ClauseRedline, 'id' | 'author_user_id' | 'contract_clause_id'>;
    actor: ManagingOrGuestCaller;
    hostEdited?: boolean;
  }): Promise<void> {
    const { event, contract, redline, actor } = input;
    if (!contract?.id) {
      return;
    }

    // Org derivation — contract → project → organization_id. NEVER the
    // caller's org (standing invariant 3). Used only for the TEAM/GUEST label.
    const hostOrgId = contract.project?.organization_id ?? null;

    const recipient = await this.resolveRecipient(event, contract, redline);
    if (!recipient || (!recipient.userId && !recipient.email)) {
      return; // nobody reachable — nothing to do
    }
    // NEVER notify the actor about their own action.
    if (recipient.userId && recipient.userId === actor.id) {
      return;
    }

    const lang = resolveRecipientLang(recipient.preferredLanguage);
    const eventClass =
      event === 'proposed'
        ? RedlineNotificationEventClass.PROPOSED
        : RedlineNotificationEventClass.DECIDED;

    // ── DEBOUNCE (Phase 1B) — leading edge sends now, the rest are batched.
    const isLeadingEdge = await this.claimWindow(
      contract.id,
      eventClass,
      recipient,
      lang,
    );
    if (!isLeadingEdge) {
      this.logger.log(
        `redline.notify.batched contract=${contract.id} ` +
          `class=${eventClass} redline=${redline.id}`,
      );
      return;
    }

    const actorName = await this.actorDisplayName(actor, hostOrgId);
    const clauseRef = await this.resolveClauseRef(redline.contract_clause_id);

    // An accept that substituted the host's wording gets the honest variant —
    // the plain 'accepted' copy would assert the counterparty's own wording is
    // live, which is false and materially misleading on a legal document.
    const variant: RedlineNotificationVariant =
      event === 'accepted' && input.hostEdited ? 'accepted_edited' : event;

    await this.send({
      lang,
      variant,
      contract,
      recipient,
      vars: {
        contractName: contract.name || contract.id,
        actorName,
        clauseRef,
      },
    });
  }

  /**
   * proposed → the HOST (contract.creator, already hydrated by the access
   * wall — not re-fetched). Every other event → the COUNTERPARTY, i.e. the
   * proposal's author, looked up by id.
   */
  private async resolveRecipient(
    event: RedlineNotifiableEvent,
    contract: Contract,
    redline: Pick<ClauseRedline, 'author_user_id'>,
  ): Promise<RedlineRecipient | null> {
    if (event === 'proposed') {
      const creator = contract.creator;
      if (!creator?.id) {
        return null;
      }
      return {
        userId: creator.id,
        email: creator.email ?? null,
        preferredLanguage:
          (creator as Partial<User>).preferred_language ?? null,
      };
    }

    if (!redline.author_user_id) {
      return null;
    }
    const author = await this.userRepo.findOne({
      where: { id: redline.author_user_id },
      select: ['id', 'email', 'preferred_language'],
    });
    if (!author) {
      return null;
    }
    return {
      userId: author.id,
      email: author.email ?? null,
      preferredLanguage: author.preferred_language ?? null,
    };
  }

  /**
   * The actor's SCRUBBED display name, via the same projection the redline
   * LIST uses. Returns undefined when the row is unavailable — the copy layer
   * then falls back to a neutral noun rather than rendering "undefined".
   */
  private async actorDisplayName(
    actor: ManagingOrGuestCaller,
    hostOrgId: string | null,
  ): Promise<string | undefined> {
    if (!actor?.id) {
      return undefined;
    }
    const row = await this.userRepo.findOne({
      where: { id: actor.id },
      select: ['id', 'first_name', 'last_name', 'account_type', 'organization_id'],
    });
    if (!row) {
      return undefined;
    }
    return redlineAuthorLabel(row, hostOrgId).name;
  }

  /**
   * "§4.2 — Payment Terms" for the info block. Best-effort: a null result just
   * omits the clause row from the email. Raw SQL (two columns) rather than a
   * repository — the contract is already walled upstream by the caller, and
   * this avoids taking a bare contract-scoped repo handle for a display string.
   */
  private async resolveClauseRef(
    contractClauseId?: string | null,
  ): Promise<string | null> {
    if (!contractClauseId) {
      return null;
    }
    try {
      const rows: Array<{ section_number: string | null; title: string | null }> =
        await this.batchRepo.manager.query(
          `SELECT cc.section_number, c.title
             FROM contract_clauses cc
             JOIN clauses c ON c.id = cc.clause_id
            WHERE cc.id = $1`,
          [contractClauseId],
        );
      const row = rows?.[0];
      if (!row) {
        return null;
      }
      const section = row.section_number?.trim();
      const title = row.title?.trim();
      if (section && title) return `§${section} — ${title}`;
      if (section) return `§${section}`;
      return title || null;
    } catch {
      return null; // display sugar only — never fail a notification for it
    }
  }

  /**
   * Atomic window claim — the guest_upload_daily_counts / metering-reserve
   * idiom (ARCHITECTURE RULE 9 Invariant 2, lesson #177). ONE statement:
   *
   *   INSERT (no window open)   → pending_count 0 → returns 0 → LEADING EDGE
   *   ON CONFLICT, window LIVE  → pending_count += 1 → returns ≥1 → SUPPRESSED
   *   ON CONFLICT, window STALE → RESET to a fresh window → returns 0 → LEADING EDGE
   *
   * ⚠️ THE STALE-WINDOW RESET IS LOAD-BEARING, NOT AN OPTIMISATION. Without it
   * the immediate-notification path silently depends on the sweeper: if the
   * sweeper ever stops (crash, paused queue, a wiped repeatable, a deploy gap),
   * the row is never deleted, every later claim sees an open window, and ALL
   * notifications for that (contract, event class, recipient) are suppressed
   * FOREVER — no email, no in-app row, no digest, and no error anywhere. With
   * the reset, a dead sweeper degrades to "digests stop, immediate
   * notifications keep working", which is a survivable failure instead of
   * permanent silence. The sweeper becomes a pure enhancement, and the claim
   * is self-healing.
   *
   * The reset discards that window's pending count (its digest is forfeited),
   * which is the deliberate trade: when the sweeper is already broken, sending
   * the live notification beats preserving a digest that may never be flushed.
   * With a healthy sweeper (60s tick vs a 3-minute window) this branch is
   * essentially unreachable.
   *
   * The row lock lives only for this statement, so nothing is held across the
   * email dispatch. On any failure we return TRUE (fail-open): a debounce is an
   * optimisation, and losing a notification is worse than sending a duplicate.
   */
  private async claimWindow(
    contractId: string,
    eventClass: RedlineNotificationEventClass,
    recipient: RedlineRecipient,
    lang: RedlineEmailLang,
  ): Promise<boolean> {
    const recipientKey = recipient.userId
      ? `u:${recipient.userId}`
      : `e:${(recipient.email ?? '').trim().toLowerCase()}`;
    const windowEndsAt = new Date(
      Date.now() + RedlineNotificationService.DIGEST_WINDOW_MS,
    );

    try {
      // Bare rows array (not a [rows, count] tuple) — the shape proven by the
      // shipped guest_upload_daily_counts UPSERT and asserted by the real-PG
      // spec, so lesson #148/#280's tuple trap cannot bite silently here.
      const rows: Array<{ pending_count: number }> =
        await this.batchRepo.manager.query(
          `INSERT INTO redline_notification_batches
             (contract_id, event_class, recipient_key, recipient_user_id,
              recipient_email, recipient_lang, pending_count, window_ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
           ON CONFLICT (contract_id, event_class, recipient_key) DO UPDATE
             SET pending_count = CASE
                   WHEN redline_notification_batches.window_ends_at < NOW()
                     THEN 0                                    -- stale → new leading edge
                   ELSE redline_notification_batches.pending_count + 1
                 END,
                 window_ends_at = CASE
                   WHEN redline_notification_batches.window_ends_at < NOW()
                     THEN EXCLUDED.window_ends_at              -- re-arm the window
                   ELSE redline_notification_batches.window_ends_at
                 END,
                 recipient_email = EXCLUDED.recipient_email,
                 recipient_lang  = EXCLUDED.recipient_lang,
                 updated_at = now()
           RETURNING pending_count`,
          [
            contractId,
            eventClass,
            recipientKey,
            recipient.userId,
            recipient.email,
            lang,
            windowEndsAt,
          ],
        );
      return Number(rows?.[0]?.pending_count ?? 0) === 0;
    } catch (err) {
      this.logger.warn(
        `redline.notify.window_claim_error contract=${contractId} ` +
          `class=${eventClass}: ${(err as Error)?.message} — sending immediately`,
      );
      return true;
    }
  }

  /**
   * Render + dispatch one notification. Shared by the immediate path and the
   * digest flush so both render through the SAME copy + template.
   */
  async send(input: {
    lang: RedlineEmailLang;
    variant: RedlineNotificationVariant;
    contract: Pick<Contract, 'id' | 'name'>;
    recipient: RedlineRecipient;
    vars: RedlineCopyVars;
  }): Promise<void> {
    const { lang, variant, contract, recipient, vars } = input;
    const copy = redlineNotificationCopy(lang, variant, vars);
    const contractLink = `${this.frontendUrl()}/app/contracts/${contract.id}`;

    const html = redlineNotificationEmail({
      lang,
      heading: copy.heading,
      body: copy.body,
      cta: copy.cta,
      note: copy.note,
      preheader: copy.preheader,
      contractName: vars.contractName,
      contractLabel: lang === 'ar' ? 'العقد' : 'Contract',
      clauseLabel: copy.clauseLabel,
      clauseRef: vars.clauseRef ?? null,
      contractLink,
    });

    const emailPayload = recipient.email
      ? {
          to: recipient.email,
          subject: copy.subject,
          html,
          templateName: `redline-${variant}`,
        }
      : undefined;

    // CHANNEL: a user row makes in-app possible (BOTH); without one, the
    // notifications table cannot hold a row at all, so email is the only path.
    if (recipient.userId) {
      await this.dispatch.dispatch({
        userId: recipient.userId,
        title: copy.inAppTitle,
        message: copy.inAppMessage,
        type: NotificationType.BOTH,
        relatedEntityType: 'contract',
        relatedEntityId: contract.id,
        email: emailPayload,
      });
      return;
    }

    if (emailPayload) {
      await this.dispatch.enqueueEmail({
        ...emailPayload,
        relatedEntityType: 'contract',
        relatedEntityId: contract.id,
      });
    }
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }
}
