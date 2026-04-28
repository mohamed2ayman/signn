import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SupportChat,
  SupportChatStatus,
  SupportChatClosedReason,
  SupportChatMessage,
  SupportChatSenderRole,
  User,
  AuditLog,
} from '../../database/entities';
import { SupportGateway } from './support.gateway';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

const ALLOWED_TRANSITIONS: Record<SupportChatStatus, SupportChatStatus[]> = {
  [SupportChatStatus.WAITING]: [SupportChatStatus.ACTIVE],
  [SupportChatStatus.ACTIVE]: [
    SupportChatStatus.TRANSFERRED,
    SupportChatStatus.CLOSED,
  ],
  [SupportChatStatus.TRANSFERRED]: [SupportChatStatus.ACTIVE],
  [SupportChatStatus.CLOSED]: [],
};

const QUEUE_WAIT_PER_POSITION_MS = 5 * 60 * 1000; // 5 min

export interface RequestActor {
  id: string;
  email: string;
  role: string;
  organization_id: string | null;
}

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    @InjectRepository(SupportChat)
    private readonly chatRepo: Repository<SupportChat>,
    @InjectRepository(SupportChatMessage)
    private readonly messageRepo: Repository<SupportChatMessage>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly gateway: SupportGateway,
  ) {}

  // ─── Lookups ────────────────────────────────────────────────

  async getChatById(chatId: string, actor: RequestActor): Promise<SupportChat> {
    const chat = await this.chatRepo.findOne({
      where: { id: chatId },
      relations: ['user', 'assigned_ops'],
    });
    if (!chat) throw new NotFoundException('Support chat not found');
    this.assertCanAccessChat(chat, actor);
    return chat;
  }

  async getChatWithMessages(
    chatId: string,
    actor: RequestActor,
  ): Promise<SupportChat & { messages: SupportChatMessage[] }> {
    const chat = await this.getChatById(chatId, actor);
    const messages = await this.messageRepo.find({
      where: { chat_id: chatId },
      order: { created_at: 'ASC' },
    });
    return { ...chat, messages };
  }

  async getMyChats(userId: string): Promise<SupportChat[]> {
    return this.chatRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  // ─── Queue (ops) ────────────────────────────────────────────

  async getQueue(actor: RequestActor): Promise<
    Array<
      SupportChat & {
        queue_position: number;
        estimated_wait_ms: number;
      }
    >
  > {
    const where: any = { status: SupportChatStatus.WAITING };
    if (actor.organization_id) where.organization_id = actor.organization_id;
    else where.organization_id = null;

    const waiting = await this.chatRepo.find({
      where,
      order: { created_at: 'ASC' },
      relations: ['user'],
    });

    return waiting.map((chat, idx) => ({
      ...chat,
      queue_position: idx + 1,
      estimated_wait_ms: (idx + 1) * QUEUE_WAIT_PER_POSITION_MS,
    }));
  }

  async getActiveForOps(opsId: string): Promise<SupportChat[]> {
    return this.chatRepo.find({
      where: { assigned_ops_id: opsId, status: SupportChatStatus.ACTIVE },
      order: { assigned_at: 'DESC' },
      relations: ['user'],
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async startChat(
    actor: RequestActor,
    topic: string,
  ): Promise<SupportChat> {
    const chat = this.chatRepo.create({
      user_id: actor.id,
      organization_id: actor.organization_id,
      status: SupportChatStatus.WAITING,
      topic,
      queued_at: new Date(),
    });
    const saved = await this.chatRepo.save(chat);

    await this.writeAudit({
      action: 'support_chat.started',
      entity_id: saved.id,
      user_id: actor.id,
      organization_id: actor.organization_id,
      new_values: { topic, status: saved.status },
    });

    await this.broadcastQueueUpdate(actor.organization_id);
    return saved;
  }

  async claimChat(
    chatId: string,
    actor: RequestActor,
  ): Promise<SupportChat> {
    this.assertOps(actor);

    const chat = await this.chatRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Support chat not found');
    this.assertSameOrgOrSysAdmin(chat, actor);
    this.assertTransition(chat.status, SupportChatStatus.ACTIVE);

    chat.status = SupportChatStatus.ACTIVE;
    chat.assigned_ops_id = actor.id;
    chat.assigned_at = new Date();
    const saved = await this.chatRepo.save(chat);

    const opsName = await this.lookupName(actor.id, actor.email);
    await this.insertSystemMessage(
      saved.id,
      `You are now connected with ${opsName}.`,
    );

    this.gateway.emitAssigned(saved.id, {
      chatId: saved.id,
      opsId: actor.id,
      opsName,
    });

    await this.writeAudit({
      action: 'support_chat.claimed',
      entity_id: saved.id,
      user_id: actor.id,
      organization_id: chat.organization_id,
      new_values: { assigned_ops_id: actor.id },
    });

    await this.broadcastQueueUpdate(chat.organization_id);
    return saved;
  }

  async transferChat(
    chatId: string,
    toOpsId: string,
    reason: string | undefined,
    actor: RequestActor,
  ): Promise<SupportChat> {
    this.assertOps(actor);

    const chat = await this.chatRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Support chat not found');
    this.assertSameOrgOrSysAdmin(chat, actor);

    if (chat.status !== SupportChatStatus.ACTIVE) {
      throw new ConflictException(
        `Cannot transfer a chat in status ${chat.status}`,
      );
    }

    const recipient = await this.userRepo.findOne({ where: { id: toOpsId } });
    if (!recipient || !OPS_ROLES.has(recipient.role)) {
      throw new NotFoundException('Recipient is not an operations member');
    }

    chat.previous_ops_id = chat.assigned_ops_id;
    chat.assigned_ops_id = toOpsId;
    // Stay ACTIVE — TRANSFERRED is a transient state surfaced in the
    // emitted event so clients can show a banner; we don't persist it.
    chat.assigned_at = new Date();
    const saved = await this.chatRepo.save(chat);

    const fromName = await this.lookupName(actor.id, actor.email);
    const toName = await this.lookupName(recipient.id, recipient.email);

    await this.insertSystemMessage(
      saved.id,
      `Chat transferred from ${fromName} to ${toName}.`,
    );

    this.gateway.emitTransferred(saved.id, {
      chatId: saved.id,
      fromOpsId: chat.previous_ops_id,
      toOpsId,
      fromName,
      toName,
      reason,
    });

    await this.writeAudit({
      action: 'support_chat.transferred',
      entity_id: saved.id,
      user_id: actor.id,
      organization_id: chat.organization_id,
      old_values: { assigned_ops_id: chat.previous_ops_id },
      new_values: { assigned_ops_id: toOpsId, reason },
    });

    return saved;
  }

  async closeChat(
    chatId: string,
    reason: SupportChatClosedReason,
    actor: RequestActor,
  ): Promise<SupportChat> {
    this.assertOps(actor);

    const chat = await this.chatRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Support chat not found');
    this.assertSameOrgOrSysAdmin(chat, actor);
    this.assertTransition(chat.status, SupportChatStatus.CLOSED);

    chat.status = SupportChatStatus.CLOSED;
    chat.closed_by = actor.id;
    chat.closed_reason = reason;
    chat.closed_at = new Date();
    const saved = await this.chatRepo.save(chat);

    const opsName = await this.lookupName(actor.id, actor.email);
    await this.insertSystemMessage(
      saved.id,
      `Chat closed by ${opsName}.`,
    );

    this.gateway.emitClosed(saved.id, {
      chatId: saved.id,
      reason,
      closedBy: actor.id,
    });

    await this.writeAudit({
      action: 'support_chat.closed',
      entity_id: saved.id,
      user_id: actor.id,
      organization_id: chat.organization_id,
      new_values: { reason },
    });

    await this.broadcastQueueUpdate(chat.organization_id);
    return saved;
  }

  // ─── CSAT ───────────────────────────────────────────────────

  async submitCsat(
    chatId: string,
    rating: number,
    comment: string | undefined,
    actor: RequestActor,
  ): Promise<SupportChat> {
    const chat = await this.chatRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Support chat not found');

    if (chat.user_id !== actor.id) {
      throw new ForbiddenException('Only the chat owner can submit CSAT');
    }
    if (chat.status !== SupportChatStatus.CLOSED) {
      throw new ConflictException('CSAT is only available on closed chats');
    }
    if (chat.csat_rating !== null && chat.csat_rating !== undefined) {
      throw new ConflictException('CSAT already submitted for this chat');
    }

    chat.csat_rating = rating;
    chat.csat_comment = comment ?? null;
    return this.chatRepo.save(chat);
  }

  async getCsatStats(actor: RequestActor): Promise<{
    total_responses: number;
    average_rating: number | null;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    recent_comments: Array<{
      chat_id: string;
      rating: number;
      comment: string;
      created_at: Date;
    }>;
  }> {
    const where: any = {};
    if (actor.organization_id) where.organization_id = actor.organization_id;

    const rated = await this.chatRepo
      .createQueryBuilder('chat')
      .where('chat.csat_rating IS NOT NULL')
      .andWhere(
        actor.organization_id
          ? 'chat.organization_id = :orgId'
          : 'chat.organization_id IS NULL',
        actor.organization_id ? { orgId: actor.organization_id } : {},
      )
      .orderBy('chat.closed_at', 'DESC')
      .getMany();

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    let sum = 0;
    for (const r of rated) {
      const rating = r.csat_rating!;
      if (rating >= 1 && rating <= 5) {
        distribution[rating as 1 | 2 | 3 | 4 | 5]++;
        sum += rating;
      }
    }

    return {
      total_responses: rated.length,
      average_rating: rated.length > 0 ? sum / rated.length : null,
      distribution,
      recent_comments: rated
        .filter((r) => r.csat_comment && r.csat_comment.trim().length > 0)
        .slice(0, 20)
        .map((r) => ({
          chat_id: r.id,
          rating: r.csat_rating!,
          comment: r.csat_comment!,
          created_at: r.closed_at ?? r.updated_at,
        })),
    };
  }

  // ─── Convert-to-ticket bookkeeping ─────────────────────────

  async markConvertedToTicket(
    chatId: string,
    ticketId: string,
  ): Promise<void> {
    await this.chatRepo.update(
      { id: chatId },
      { converted_ticket_id: ticketId },
    );
  }

  /**
   * Public helper: builds a ticket description from the last 50 messages.
   * Used by the convert-to-ticket controller path.
   */
  async buildTicketDescription(chatId: string): Promise<string> {
    const messages = await this.messageRepo.find({
      where: { chat_id: chatId },
      order: { created_at: 'DESC' },
      take: 50,
      relations: ['sender'],
    });

    // Reverse so oldest of the last 50 is first.
    return messages
      .slice()
      .reverse()
      .map((m) => {
        const who =
          m.sender_role === SupportChatSenderRole.SYSTEM
            ? 'system'
            : m.sender?.email ?? m.sender_role.toLowerCase();
        const ts = m.created_at.toISOString();
        const body = m.body || (m.attachment_name ? `[file: ${m.attachment_name}]` : '');
        return `[${ts}] ${who}: ${body}`;
      })
      .join('\n');
  }

  // ─── Internal helpers ──────────────────────────────────────

  /**
   * Insert a SYSTEM-role message and emit it to the chat room.
   * Exposed so the message service can also use it.
   */
  async insertSystemMessage(
    chatId: string,
    body: string,
  ): Promise<SupportChatMessage> {
    const msg = this.messageRepo.create({
      chat_id: chatId,
      sender_id: null,
      sender_role: SupportChatSenderRole.SYSTEM,
      body,
    });
    const saved = await this.messageRepo.save(msg);
    this.gateway.emitMessage(chatId, saved);
    return saved;
  }

  private async broadcastQueueUpdate(orgId: string | null): Promise<void> {
    const where: any = { status: SupportChatStatus.WAITING };
    if (orgId) where.organization_id = orgId;
    else where.organization_id = null;
    const queueLength = await this.chatRepo.count({ where });
    this.gateway.emitQueueUpdate(orgId, {
      queue_length: queueLength,
      estimated_wait_ms: queueLength * QUEUE_WAIT_PER_POSITION_MS,
    });
  }

  private async lookupName(
    userId: string,
    fallbackEmail: string,
  ): Promise<string> {
    const u = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'first_name', 'last_name', 'email'] as any,
    });
    if (!u) return fallbackEmail;
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return full || u.email || fallbackEmail;
  }

  private assertOps(actor: RequestActor): void {
    if (!OPS_ROLES.has(actor.role)) {
      throw new ForbiddenException('Operations role required');
    }
  }

  private assertCanAccessChat(chat: SupportChat, actor: RequestActor): void {
    if (chat.user_id === actor.id) return;
    if (OPS_ROLES.has(actor.role)) {
      if (actor.role === 'SYSTEM_ADMIN') return;
      // Org-scoped for OPERATIONS members
      if (
        (chat.organization_id ?? null) === (actor.organization_id ?? null)
      ) {
        return;
      }
    }
    throw new ForbiddenException('You do not have access to this chat');
  }

  private assertSameOrgOrSysAdmin(
    chat: SupportChat,
    actor: RequestActor,
  ): void {
    if (actor.role === 'SYSTEM_ADMIN') return;
    if ((chat.organization_id ?? null) !== (actor.organization_id ?? null)) {
      throw new ForbiddenException('Chat belongs to a different organization');
    }
  }

  private assertTransition(
    from: SupportChatStatus,
    to: SupportChatStatus,
  ): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Invalid status transition ${from} → ${to}`,
      );
    }
  }

  private async writeAudit(entry: {
    action: string;
    entity_id: string;
    user_id: string;
    organization_id: string | null;
    old_values?: Record<string, unknown>;
    new_values?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditRepo.insert({
        user_id: entry.user_id,
        organization_id: entry.organization_id as any,
        action: entry.action,
        entity_type: 'support_chat',
        entity_id: entry.entity_id,
        old_values: entry.old_values ?? null,
        new_values: entry.new_values ?? null,
      } as any);
    } catch (err) {
      // Audit failures must never block the chat lifecycle
      this.logger.warn(
        `Failed to write audit log for ${entry.action}: ${(err as Error).message}`,
      );
    }
  }
}
