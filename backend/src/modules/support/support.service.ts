import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SupportTicket,
  SupportTicketReply,
  OrganizationSubscription,
  SubscriptionStatus,
} from '../../database/entities';

/**
 * Shape returned by the admin tickets endpoint — the regular SupportTicket
 * entity plus the ACTIVE subscription plan name of the ticket owner's org.
 * `planName` is null for tickets created by users without an active plan
 * (free trial, expired, individual guest, etc.).
 */
export type AdminTicket = SupportTicket & { planName: string | null };

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepository: Repository<SupportTicket>,
    @InjectRepository(SupportTicketReply)
    private readonly replyRepository: Repository<SupportTicketReply>,
    @InjectRepository(OrganizationSubscription)
    private readonly orgSubscriptionRepository: Repository<OrganizationSubscription>,
  ) {}

  async createTicket(
    userId: string,
    organizationId: string | null,
    data: { category: string; priority: string; subject: string; description: string },
  ): Promise<SupportTicket> {
    const ticket = this.ticketRepository.create({
      user_id: userId,
      organization_id: organizationId as any,
      category: data.category,
      priority: data.priority,
      subject: data.subject,
      description: data.description,
      status: 'OPEN',
    } as any);

    const saved: SupportTicket = await this.ticketRepository.save(ticket as any) as any;
    this.logger.log(`Support ticket created: ${saved.id} by user ${userId}`);
    return saved;
  }

  async getTicketsByUser(userId: string): Promise<SupportTicket[]> {
    return this.ticketRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async getAllTickets(filters?: {
    status?: string;
    priority?: string;
    category?: string;
  }): Promise<AdminTicket[]> {
    const qb = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.user', 'user')
      .leftJoinAndSelect('ticket.organization', 'organization')
      .leftJoinAndSelect('ticket.assignee', 'assignee');

    if (filters?.status) {
      qb.andWhere('ticket.status = :status', { status: filters.status });
    }
    if (filters?.priority) {
      qb.andWhere('ticket.priority = :priority', { priority: filters.priority });
    }
    if (filters?.category) {
      qb.andWhere('ticket.category = :category', { category: filters.category });
    }

    qb.orderBy('ticket.created_at', 'DESC');
    const tickets = await qb.getMany();

    // ── Resolve the ACTIVE plan name for each ticket's organization ─────
    // Tickets created by users without an org or without an active
    // subscription simply return planName: null — the UI then treats
    // them as the Standard support tier.
    const orgIds = Array.from(
      new Set(
        tickets
          .map((t) => t.organization_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const planByOrgId = new Map<string, string>();
    if (orgIds.length > 0) {
      const subs = await this.orgSubscriptionRepository
        .createQueryBuilder('sub')
        .leftJoinAndSelect('sub.plan', 'plan')
        .where('sub.organization_id IN (:...orgIds)', { orgIds })
        .andWhere('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
        .getMany();

      for (const sub of subs) {
        if (sub.plan?.name) planByOrgId.set(sub.organization_id, sub.plan.name);
      }
    }

    return tickets.map((t) => ({
      ...t,
      planName: t.organization_id ? planByOrgId.get(t.organization_id) ?? null : null,
    })) as AdminTicket[];
  }

  async getTicketById(ticketId: string): Promise<SupportTicket & { replies: SupportTicketReply[] }> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: ['user', 'organization', 'assignee'],
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    const replies = await this.replyRepository.find({
      where: { ticket_id: ticketId },
      relations: ['user'],
      order: { created_at: 'ASC' },
    });

    return { ...ticket, replies };
  }

  async addReply(
    ticketId: string,
    userId: string,
    content: string,
    isInternalNote = false,
  ): Promise<SupportTicketReply> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    const reply = this.replyRepository.create({
      ticket_id: ticketId,
      user_id: userId,
      content,
      is_internal_note: isInternalNote,
    });

    return this.replyRepository.save(reply);
  }

  async updateStatus(ticketId: string, status: string, assignedTo?: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    ticket.status = status;
    if (assignedTo !== undefined) {
      ticket.assigned_to = assignedTo;
    }

    return this.ticketRepository.save(ticket);
  }

  async assignTicket(ticketId: string, assignedTo: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    ticket.assigned_to = assignedTo;
    if (ticket.status === 'OPEN') {
      ticket.status = 'IN_PROGRESS';
    }

    return this.ticketRepository.save(ticket);
  }
}
