import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { Contract } from '../../../database/entities';
import { ChatSession } from '../../../database/entities/chat-session.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from '../../../database/entities/chat-message.entity';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { AiService } from '../../ai/ai.service';
import { MeteringService } from '../../metering/services/metering.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';

/** The guest principal shape the JwtStrategy surfaces (Path B). */
export interface GuestPrincipal {
  id: string;
  organization_id: string | null;
  role: string;
  account_type: string;
}

/** Sanitized message projection — the ONLY message shape guests receive. */
export interface GuestChatMessageView {
  id: string;
  role: ChatMessageRole;
  content: string | null;
  citations: Record<string, any>[] | null;
  status: ChatMessageStatus;
  error_message: string | null;
  created_at: Date;
}

/**
 * Guest chat Slice 1 — guest-walled multi-turn AI chat about the ONE bound
 * contract (backend only).
 *
 * Locked invariants:
 *   1. BINDING WALL — every route resolves the contract through
 *      `ContractAccessService.findAccessibleContract` (guest caller →
 *      `findForGuest`, the `guest_contract_access` binding; 404 NOT 403, no
 *      existence leak). Sessions are then loaded by
 *      (id, user_id = guest, contract_id = the walled contract) so a session
 *      can never be read by another guest and can never receive messages
 *      resolved against a different contract.
 *   2. STRICT CONTEXT — the AI context is assembled from EXACTLY the walled
 *      contract read the guest viewer uses: contract metadata + ACTIVE live
 *      clauses (`contract_clauses.is_proposed = false` is enforced by the
 *      wall's JOIN condition itself; `clause.is_active` filtered here).
 *      NOTHING else: no comments (Slice 3), no risk / compliance /
 *      obligations, no proposed clauses, no version history, no other
 *      contracts. There is deliberately NO other data source in this file.
 *   3. RACE-SAFE DAILY CAP — 20 guest questions/day PER CONTRACT (UTC day),
 *      enforced by a SINGLE atomic conditional UPSERT on
 *      `guest_ai_query_daily_counts` (the guest_upload idiom — Rule 9
 *      Invariant 2; lesson #177). A claimed slot is released if dispatch
 *      fails synchronously (fail-safe toward over-denial).
 *   4. SUBJECT = HOST ORG — the `guest_ai_query` meter reserves against the
 *      inviting org (contract → project → organization_id); the guest's null
 *      org is never trusted. Reserve BEFORE dispatch; commit on AI success;
 *      release on failure — with the observable
 *      `metering.guest_ai_query.*` applied:false signals.
 *   5. PII scrubbing is INHERITED — the conversational agent calls
 *      `_call_model(scrub=True)` (PII slice, PR #122). No scrub code here.
 *
 * Entity choice (recon 0a): host ChatSession/ChatMessage rows are REUSED, not
 * forked — `user_id` = the guest user row, `org_id` = the HOST org (satisfies
 * NOT NULL + keeps tenancy attribution with the inviting org),
 * `contract_id` = the bound contract (ALWAYS set for guest sessions). No new
 * discriminator column: ownership scoping by `user_id` already partitions
 * guest sessions from host sessions on both sides (host chat reads scope by
 * the host's own user_id; these routes scope by the guest's).
 */
@Injectable()
export class GuestChatService {
  private readonly logger = new Logger(GuestChatService.name);

  /**
   * Product-locked daily cap: a contract accepts at most this many GUEST
   * AI questions per UTC calendar day (across all guests bound to it). The
   * `guest_ai_query` meter is billing/attribution only — THIS is the
   * enforcer. Single source of truth for the cap; the 429 payload and the
   * {remaining, cap} response both read it.
   */
  static readonly GUEST_DAILY_AI_QUERY_CAP = 20;

  /**
   * Cap on the assembled contract context (chars). Keeps the prompt inside
   * the same order of magnitude as the host pipeline's single-call ceiling
   * (30k chars for extraction; chat carries history on top). Clauses past
   * the budget are omitted and listed by section so the model can say so.
   */
  static readonly GUEST_CHAT_CONTEXT_MAX_CHARS = 60_000;

  /** Staleness backstop for in-flight assistant turns — mirrors host chat. */
  private static readonly STALE_MS = 5 * 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly contractAccess: ContractAccessService,
    private readonly aiService: AiService,
    private readonly metering: MeteringService,
    // lint-exempt: chat scopes by user_id/session_id (ownership), NOT contract→org — same posture as the host chat module's repos; the contract itself is walled via ContractAccessService on every route
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    // lint-exempt: chat scopes by session_id/user_id (ownership), NOT contract→org — same posture as the host chat module's repos; the contract itself is walled via ContractAccessService on every route
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
  ) {}

  // ─── The wall ──────────────────────────────────────────────────────────

  /**
   * Resolve the contract through the guest binding wall. 404 (never 403) on
   * any miss — cross-contract probes learn nothing. Returns the contract
   * WITH its live (is_proposed=false) clause set loaded — the same read the
   * guest viewer serves, so the chat context can never see more than the
   * viewer does.
   */
  private async wallContract(
    contractId: string,
    guest: GuestPrincipal,
  ): Promise<Contract> {
    return this.contractAccess.findAccessibleContract(contractId, {
      id: guest.id,
      organization_id: guest.organization_id ?? null,
      role: guest.role as any,
      account_type: guest.account_type as any,
    });
  }

  /** Load a session owned by THIS guest on THIS contract — 404 otherwise. */
  private async loadOwnedSession(
    sessionId: string,
    contractId: string,
    guestId: string,
  ): Promise<ChatSession> {
    const session = await this.sessionRepo.findOne({ // lint-exempt: guest-ownership read (ChatSession by id+user_id+contract_id) UNDER the route's findAccessibleContract wall — not a bare contract→org read
      where: { id: sessionId, user_id: guestId, contract_id: contractId },
    });
    if (!session) {
      // Same axis-free 404 as the wall: wrong guest, wrong contract, or
      // nonexistent id are indistinguishable.
      throw new NotFoundException('Chat session not found');
    }
    return session;
  }

  // ─── Sessions ──────────────────────────────────────────────────────────

  async createSession(contractId: string, guest: GuestPrincipal) {
    const contract = await this.wallContract(contractId, guest);
    const hostOrgId = contract.project?.organization_id;
    if (!hostOrgId) {
      // A contract without a project/org cannot be metered or attributed.
      throw new NotFoundException('Contract not found');
    }
    const session = await this.sessionRepo.save( // lint-exempt: write (guest session insert); the scoped chokepoint is read-only; contract already walled
      this.sessionRepo.create({
        user_id: guest.id,
        org_id: hostOrgId,
        contract_id: contractId,
      }),
    );
    return {
      id: session.id,
      contract_id: session.contract_id,
      created_at: session.created_at,
    };
  }

  /** Session history for resume — sanitized projection only. */
  async getSession(
    contractId: string,
    sessionId: string,
    guest: GuestPrincipal,
  ) {
    await this.wallContract(contractId, guest);
    const session = await this.loadOwnedSession(sessionId, contractId, guest.id);
    const messages = await this.messageRepo.find({ // lint-exempt: session-scoped read (ChatMessage by session_id, owning session verified under the wall) — not a contract→org read
      where: { session_id: session.id },
      order: { created_at: 'ASC' },
    });
    return {
      id: session.id,
      contract_id: session.contract_id,
      created_at: session.created_at,
      messages: messages.map((m) => this.sanitizeMessage(m)),
    };
  }

  // ─── Send a question ───────────────────────────────────────────────────

  /**
   * ORDER (locked): burst throttle (controller guard) → binding wall →
   * session ownership → daily-counter claim → meter reserve → context
   * assembly → dispatch. On dispatch failure BOTH the reservation and the
   * daily slot are released.
   */
  async sendMessage(
    contractId: string,
    sessionId: string,
    guest: GuestPrincipal,
    message: string,
  ) {
    const cap = GuestChatService.GUEST_DAILY_AI_QUERY_CAP;
    const contract = await this.wallContract(contractId, guest);
    const session = await this.loadOwnedSession(sessionId, contractId, guest.id);
    const hostOrgId = contract.project?.organization_id;
    if (!hostOrgId) {
      throw new NotFoundException('Contract not found');
    }

    // 1 — race-safe daily cap (atomic conditional UPSERT; 0 rows = capped).
    const utcDay = new Date().toISOString().slice(0, 10);
    const claim: Array<{ count: number }> = await this.dataSource.query(
      `INSERT INTO guest_ai_query_daily_counts (contract_id, day, count)
            VALUES ($1, $2, 1)
       ON CONFLICT (contract_id, day) DO UPDATE
            SET count = guest_ai_query_daily_counts.count + 1, updated_at = now()
          WHERE guest_ai_query_daily_counts.count < $3
       RETURNING count`,
      [contractId, utcDay, cap],
    );
    if (claim.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'GUEST_AI_QUERY_DAILY_LIMIT',
          message:
            `Daily question limit reached. A maximum of ${cap} AI questions ` +
            `can be asked about this contract per day. Please try again tomorrow.`,
          remaining: 0,
          cap,
          resets_at: this.nextUtcMidnightIso(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let claimedCount = Number(claim[0].count);

    // 2 — meter reserve (billing/attribution; subject = HOST org, derived by
    // the resolver from contract → project → org — the guest org is never
    // trusted). Reserve failure refunds the daily slot.
    let reservationId: string | null = null;
    try {
      const reservation = await this.metering.reserve({
        caller: {
          user_id: guest.id,
          jwt_organization_id: guest.organization_id ?? null,
          account_type: 'GUEST',
        },
        meterKey: MeterKey.GUEST_AI_QUERY,
        amount: 1,
        idempotencyKey: randomUUID(),
        contractId,
        actorRef: guest.id,
        metadata: {
          route: 'POST /guest/contracts/:id/chat/sessions/:sid/messages',
        },
      });
      reservationId = reservation.reservation_id;
    } catch (err) {
      await this.releaseDailySlot(contractId, utcDay);
      throw err;
    }

    // 3 — history for multi-turn, loaded BEFORE persisting the new user row.
    // The conversational agent appends the current `message` as the final
    // user turn itself, so including it in history would duplicate the turn.
    const prior = await this.messageRepo.find({ // lint-exempt: session-scoped read (ChatMessage history by session_id, owning session verified under the wall) — not a contract→org read
      where: { session_id: session.id },
      order: { created_at: 'ASC' },
    });
    const historyForAi = prior
      .filter((m) => m.content && m.status === ChatMessageStatus.COMPLETED)
      .map((m) => ({
        role: m.role === ChatMessageRole.USER ? 'user' : 'assistant',
        content: m.content as string,
      }));

    // 4 — STRICT context: the walled contract read ONLY (invariant 2).
    const contractContext = this.buildContractContext(contract);

    // 5 — persist the user turn (terminal on creation).
    const userMessage = await this.messageRepo.save( // lint-exempt: write (guest user-turn insert); the scoped chokepoint is read-only
      this.messageRepo.create({
        session_id: session.id,
        contract_id: contractId,
        user_id: guest.id,
        org_id: hostOrgId,
        role: ChatMessageRole.USER,
        content: message,
        status: ChatMessageStatus.COMPLETED,
      }),
    );

    // 6 — dispatch. Failure releases BOTH the reservation and the daily slot.
    let jobId: string | null = null;
    let assistantStatus = ChatMessageStatus.PENDING;
    let errorMessage: string | null = null;
    try {
      const aiResponse = await this.aiService.triggerChat({
        message,
        contract_id: contractId,
        org_id: hostOrgId,
        history: historyForAi,
        contract_context: contractContext,
      });
      jobId = (aiResponse as any).job_id || null;
    } catch (err) {
      this.logger.error(
        `guest chat dispatch failed for contract ${contractId}: ${(err as Error).message}`,
      );
      assistantStatus = ChatMessageStatus.FAILED;
      errorMessage =
        'The AI service could not be reached. This question was not counted.';
      await this.releaseReservationOnFailure(reservationId);
      reservationId = null;
      await this.releaseDailySlot(contractId, utcDay);
      claimedCount = Math.max(0, claimedCount - 1);
    }

    const assistantMessage = await this.messageRepo.save( // lint-exempt: write (assistant placeholder insert); the scoped chokepoint is read-only
      this.messageRepo.create({
        session_id: session.id,
        contract_id: contractId,
        user_id: guest.id,
        org_id: hostOrgId,
        role: ChatMessageRole.ASSISTANT,
        content: null,
        citations: null,
        status: assistantStatus,
        job_id: jobId,
        error_message: errorMessage,
        reservation_id: reservationId,
      }),
    );

    session.updated_at = new Date();
    await this.sessionRepo.save(session); // lint-exempt: write (session touch); the scoped chokepoint is read-only

    return {
      user_message: this.sanitizeMessage(userMessage),
      assistant_message: this.sanitizeMessage(assistantMessage),
      remaining: Math.max(0, cap - claimedCount),
      cap,
    };
  }

  // ─── Status poll (the async advancer) ──────────────────────────────────

  /**
   * Endpoint-triggered advancer, mirroring host chat: idempotent on terminal
   * rows, 5-minute staleness backstop. Metering reconcile rides the terminal
   * flip — commit on COMPLETED, release on FAILED. The engine's transitions
   * are status-guarded at-most-once, so a concurrent double-poll can never
   * double-charge or double-refund (Rule 9 Invariant 4).
   */
  async getMessageStatus(
    contractId: string,
    messageId: string,
    guest: GuestPrincipal,
  ): Promise<GuestChatMessageView> {
    await this.wallContract(contractId, guest);
    const msg = await this.messageRepo.findOne({ // lint-exempt: guest-ownership read (ChatMessage by id+user_id+contract_id) UNDER the route's findAccessibleContract wall — not a bare contract→org read
      where: { id: messageId, user_id: guest.id, contract_id: contractId },
    });
    if (!msg) {
      throw new NotFoundException('Message not found');
    }

    if (
      msg.status === ChatMessageStatus.COMPLETED ||
      msg.status === ChatMessageStatus.FAILED
    ) {
      return this.sanitizeMessage(msg);
    }

    if (!msg.job_id) {
      return this.sanitizeMessage(await this.failIfStale(msg));
    }

    let job: Record<string, any>;
    try {
      job = await this.aiService.getJobStatus(msg.job_id);
    } catch {
      return this.sanitizeMessage(await this.failIfStale(msg));
    }

    if (job.status === 'completed') {
      const r = job.result?.result ?? job.result;
      msg.content = r?.response || r?.content || 'I processed your request.';
      msg.citations = r?.citations || null;
      msg.status = ChatMessageStatus.COMPLETED;
      const saved = await this.messageRepo.save(msg); // lint-exempt: write (status advance on an ownership-verified row); the scoped chokepoint is read-only
      await this.commitReservationOnSuccess(msg.reservation_id);
      return this.sanitizeMessage(saved);
    }

    if (job.status === 'failed') {
      msg.status = ChatMessageStatus.FAILED;
      msg.error_message =
        typeof job.error === 'string'
          ? job.error
          : 'The AI service failed to process this request.';
      const saved = await this.messageRepo.save(msg); // lint-exempt: write (status advance on an ownership-verified row); the scoped chokepoint is read-only
      await this.releaseReservationOnFailure(msg.reservation_id);
      return this.sanitizeMessage(saved);
    }

    if (msg.status === ChatMessageStatus.PENDING) {
      msg.status = ChatMessageStatus.PROCESSING;
      await this.messageRepo.save(msg); // lint-exempt: write (status advance on an ownership-verified row); the scoped chokepoint is read-only
    }
    return this.sanitizeMessage(await this.failIfStale(msg));
  }

  private async failIfStale(msg: ChatMessage): Promise<ChatMessage> {
    const age = Date.now() - new Date(msg.created_at).getTime();
    if (age > GuestChatService.STALE_MS) {
      msg.status = ChatMessageStatus.FAILED;
      msg.error_message =
        'The response timed out. Please try sending your question again.';
      const saved = await this.messageRepo.save(msg); // lint-exempt: write (staleness-backstop status advance on an ownership-verified row); the scoped chokepoint is read-only
      await this.releaseReservationOnFailure(msg.reservation_id);
      return saved;
    }
    return msg;
  }

  // ─── Context assembly (invariant 2 — the security-critical projection) ──

  /**
   * Build the AI grounding context from EXACTLY the walled contract read:
   * contract metadata + live ACTIVE clauses. The wall's JOIN already excludes
   * `is_proposed = true` junction rows; inactive clauses are dropped here.
   * Sections are labeled `§<section_number>` so the model can cite them and
   * the frontend can key citation chips by section.
   *
   * This function receives ONLY the Contract object from the wall — it has
   * no repository access, so no other data source can leak in.
   */
  buildContractContext(contract: Contract): string {
    const meta: string[] = ['### Contract'];
    meta.push(`Name: ${contract.name ?? 'Untitled'}`);
    if (contract.contract_type) meta.push(`Type: ${contract.contract_type}`);
    if (contract.status) meta.push(`Status: ${contract.status}`);
    if (contract.party_first_name || contract.party_second_name) {
      meta.push(
        `Parties: ${contract.party_first_name ?? '—'} / ${contract.party_second_name ?? '—'}`,
      );
    }
    if (contract.start_date) meta.push(`Start date: ${contract.start_date}`);
    if (contract.end_date) meta.push(`End date: ${contract.end_date}`);

    const junctions = [...(contract.contract_clauses ?? [])].sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
    );

    const parts: string[] = [meta.join('\n'), '\n### Clauses'];
    let used = parts.join('\n').length;
    const omitted: string[] = [];

    for (const cc of junctions) {
      const clause = cc.clause;
      if (!clause) continue;
      if (clause.is_active === false) continue;
      const section = cc.section_number ?? String((cc.order_index ?? 0) + 1);
      const typeNote = clause.clause_type ? ` (type: ${clause.clause_type})` : '';
      const block = `\n[§${section}] ${clause.title ?? ''}${typeNote}\n${clause.content ?? ''}`;
      if (
        used + block.length >
        GuestChatService.GUEST_CHAT_CONTEXT_MAX_CHARS
      ) {
        omitted.push(`§${section}`);
        continue;
      }
      parts.push(block);
      used += block.length;
    }

    if (omitted.length > 0) {
      parts.push(
        `\n[Note: ${omitted.length} clause(s) omitted for length: ${omitted.join(', ')}. ` +
          `Tell the user to consult the contract viewer for their full text.]`,
      );
    }

    return parts.join('\n');
  }

  // ─── Metering reconcile + counter refund helpers ────────────────────────

  private async commitReservationOnSuccess(
    reservationId: string | null,
  ): Promise<void> {
    if (!reservationId) return;
    try {
      const result = await this.metering.commit(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `metering.guest_ai_query.committed_after_release reservation=${reservationId} status=${result.status}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `metering.guest_ai_query.commit_error reservation=${reservationId}: ${(err as Error).message}`,
      );
    }
  }

  private async releaseReservationOnFailure(
    reservationId: string | null,
  ): Promise<void> {
    if (!reservationId) return;
    try {
      const result = await this.metering.release(reservationId);
      if (!result.applied) {
        this.logger.warn(
          `metering.guest_ai_query.released_after_terminal reservation=${reservationId} status=${result.status}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `metering.guest_ai_query.release_error reservation=${reservationId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Refund a claimed daily slot (dispatch failed synchronously — the guest
   * got no answer, the day should not be charged). Best-effort; never throws.
   * NOT called on ASYNC failure: the decrement is not idempotent, and the
   * status advancer can be raced by concurrent polls — the meter release
   * (engine-guarded, at-most-once) is the refund of record there.
   */
  private async releaseDailySlot(
    contractId: string,
    utcDay: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE guest_ai_query_daily_counts
            SET count = count - 1, updated_at = now()
          WHERE contract_id = $1 AND day = $2 AND count > 0`,
        [contractId, utcDay],
      );
    } catch (err) {
      this.logger.error(
        `guest_ai_query daily slot release failed for contract ${contractId}: ${(err as Error).message}`,
      );
    }
  }

  private nextUtcMidnightIso(): string {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString();
  }

  private sanitizeMessage(m: ChatMessage): GuestChatMessageView {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      citations: m.citations,
      status: m.status,
      error_message: m.error_message,
      created_at: m.created_at,
    };
  }
}
