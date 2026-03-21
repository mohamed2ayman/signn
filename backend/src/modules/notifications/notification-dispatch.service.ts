import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../../database/entities';
import { EmailJobData } from './email-queue.processor';
import * as templates from './templates';

/**
 * NotificationDispatchService
 * ═══════════════════════════════════════════════════════════
 * Central dispatcher that routes notifications to the right channel:
 *   • IN_APP  → creates a DB notification record
 *   • EMAIL   → enqueues an email job via Bull
 *   • BOTH    → does both
 *
 * All email sending goes through the Bull queue for reliability
 * with 3 retries + exponential backoff.
 * ═══════════════════════════════════════════════════════════
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectQueue('email-queue') private readonly emailQueue: Queue,
  ) {}

  // ─── Low-level dispatch ──────────────────────────────────

  /**
   * Dispatch a notification to one or both channels.
   */
  async dispatch(params: {
    userId: string;
    title: string;
    message: string;
    type: NotificationType;
    relatedEntityType?: string;
    relatedEntityId?: string;
    /** Required when type is EMAIL or BOTH */
    email?: {
      to: string;
      subject: string;
      html: string;
      templateName?: string;
    };
  }): Promise<void> {
    const { userId, title, message, type, relatedEntityType, relatedEntityId, email } = params;

    // Create in-app notification if needed
    if (type === NotificationType.IN_APP || type === NotificationType.BOTH) {
      await this.notificationsService.create({
        user_id: userId,
        title,
        message,
        type,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      });
    }

    // Enqueue email if needed
    if ((type === NotificationType.EMAIL || type === NotificationType.BOTH) && email) {
      await this.enqueueEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        templateName: email.templateName,
        relatedEntityType,
        relatedEntityId,
      });
    }
  }

  /**
   * Enqueue an email with 3 retries + exponential backoff.
   */
  async enqueueEmail(data: EmailJobData): Promise<void> {
    try {
      await this.emailQueue.add('send-email', data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 25s, 125s
        },
        removeOnComplete: true,
        removeOnFail: false, // Keep failed jobs for debugging
      });
      this.logger.log(`Email enqueued → ${data.to} [${data.templateName || 'generic'}]`);
    } catch (error) {
      this.logger.error(`Failed to enqueue email → ${data.to}: ${error.message}`);
    }
  }

  // ─── High-level template dispatchers ─────────────────────

  /**
   * 1. Team member invitation
   */
  async sendTeamInvitation(params: {
    recipientEmail: string;
    recipientName?: string;
    organizationName: string;
    role: string;
    inviterName: string;
    invitationToken: string;
    frontendUrl: string;
  }): Promise<void> {
    const invitationLink = `${params.frontendUrl}/auth/accept-invitation?token=${params.invitationToken}`;

    await this.enqueueEmail({
      to: params.recipientEmail,
      subject: `Sign — You've been invited to ${params.organizationName}`,
      html: templates.teamInvitationEmail({
        recipientName: params.recipientName,
        organizationName: params.organizationName,
        role: params.role,
        inviterName: params.inviterName,
        invitationLink,
      }),
      templateName: 'team-invitation',
    });
  }

  /**
   * 2. Contractor invitation (project party)
   */
  async sendContractorInvitation(params: {
    contractorEmail: string;
    projectName: string;
    organizationName: string;
    role: string;
    inviterName: string;
    invitationToken: string;
    frontendUrl: string;
  }): Promise<void> {
    const invitationLink = `${params.frontendUrl}/invitation/accept?token=${params.invitationToken}`;

    await this.enqueueEmail({
      to: params.contractorEmail,
      subject: `Sign — Collaboration invite for ${params.projectName}`,
      html: templates.contractorInvitationEmail({
        contractorEmail: params.contractorEmail,
        projectName: params.projectName,
        organizationName: params.organizationName,
        role: params.role,
        inviterName: params.inviterName,
        invitationLink,
      }),
      templateName: 'contractor-invitation',
    });
  }

  /**
   * 3. Approval requested
   */
  async sendApprovalRequested(params: {
    userId: string;
    reviewerEmail: string;
    reviewerName: string;
    contractName: string;
    contractId: string;
    projectName: string;
    requesterName: string;
    frontendUrl: string;
  }): Promise<void> {
    const contractLink = `${params.frontendUrl}/app/contracts/${params.contractId}`;

    await this.dispatch({
      userId: params.userId,
      title: 'Approval Required',
      message: `${params.requesterName} submitted "${params.contractName}" for your approval`,
      type: NotificationType.BOTH,
      relatedEntityType: 'contract',
      relatedEntityId: params.contractId,
      email: {
        to: params.reviewerEmail,
        subject: `Sign — Approval required: ${params.contractName}`,
        html: templates.approvalRequestedEmail({
          reviewerName: params.reviewerName,
          contractName: params.contractName,
          projectName: params.projectName,
          requesterName: params.requesterName,
          contractLink,
        }),
        templateName: 'approval-requested',
      },
    });
  }

  /**
   * 4. Approval decision
   */
  async sendApprovalDecision(params: {
    userId: string;
    requesterEmail: string;
    requesterName: string;
    contractName: string;
    contractId: string;
    projectName: string;
    reviewerName: string;
    decision: 'approved' | 'rejected' | 'changes_requested';
    comments?: string;
    frontendUrl: string;
  }): Promise<void> {
    const contractLink = `${params.frontendUrl}/app/contracts/${params.contractId}`;
    const decisionLabel = params.decision === 'approved' ? 'approved' : params.decision === 'rejected' ? 'rejected' : 'requested changes on';

    await this.dispatch({
      userId: params.userId,
      title: `Contract ${params.decision === 'approved' ? 'Approved' : params.decision === 'rejected' ? 'Rejected' : 'Changes Requested'}`,
      message: `${params.reviewerName} ${decisionLabel} "${params.contractName}"`,
      type: NotificationType.BOTH,
      relatedEntityType: 'contract',
      relatedEntityId: params.contractId,
      email: {
        to: params.requesterEmail,
        subject: `Sign — ${params.contractName} ${decisionLabel}`,
        html: templates.approvalDecisionEmail({
          requesterName: params.requesterName,
          contractName: params.contractName,
          projectName: params.projectName,
          reviewerName: params.reviewerName,
          decision: params.decision,
          comments: params.comments,
          contractLink,
        }),
        templateName: 'approval-decision',
      },
    });
  }

  /**
   * 5. Contract shared
   */
  async sendContractShared(params: {
    recipientEmail: string;
    recipientName?: string;
    contractName: string;
    sharedByName: string;
    permission: string;
    expiresAt?: string;
    shareToken: string;
    frontendUrl: string;
  }): Promise<void> {
    const shareLink = `${params.frontendUrl}/shared/${params.shareToken}`;

    await this.enqueueEmail({
      to: params.recipientEmail,
      subject: `Sign — "${params.contractName}" shared with you`,
      html: templates.contractSharedEmail({
        recipientName: params.recipientName,
        contractName: params.contractName,
        sharedByName: params.sharedByName,
        permission: params.permission,
        expiresAt: params.expiresAt,
        shareLink,
      }),
      templateName: 'contract-shared',
    });
  }

  /**
   * 6. Obligation reminder
   */
  async sendObligationReminder(params: {
    userId: string;
    userEmail: string;
    userName: string;
    obligationDescription: string;
    obligationId: string;
    contractName: string;
    dueDate: Date;
    daysRemaining: number;
    frontendUrl: string;
  }): Promise<void> {
    const obligationLink = `${params.frontendUrl}/app/obligations`;

    await this.dispatch({
      userId: params.userId,
      title: params.daysRemaining <= 0 ? 'Obligation Overdue!' : 'Obligation Due Soon',
      message: `"${params.obligationDescription}" is ${params.daysRemaining <= 0 ? 'overdue' : `due in ${params.daysRemaining} day${params.daysRemaining === 1 ? '' : 's'}`}`,
      type: NotificationType.BOTH,
      relatedEntityType: 'obligation',
      relatedEntityId: params.obligationId,
      email: {
        to: params.userEmail,
        subject: `Sign — Obligation ${params.daysRemaining <= 0 ? 'overdue' : 'due soon'}: ${params.obligationDescription}`,
        html: templates.obligationReminderEmail({
          userName: params.userName,
          obligationDescription: params.obligationDescription,
          contractName: params.contractName,
          dueDate: params.dueDate.toISOString().split('T')[0],
          daysRemaining: params.daysRemaining,
          obligationLink,
        }),
        templateName: 'obligation-reminder',
      },
    });
  }

  /**
   * 7. Risk analysis complete
   */
  async sendRiskAnalysisComplete(params: {
    userId: string;
    userEmail: string;
    userName: string;
    contractName: string;
    contractId: string;
    projectName: string;
    highRisks: number;
    mediumRisks: number;
    lowRisks: number;
    frontendUrl: string;
  }): Promise<void> {
    const contractLink = `${params.frontendUrl}/app/contracts/${params.contractId}`;

    await this.dispatch({
      userId: params.userId,
      title: 'Risk Analysis Complete',
      message: `Analysis of "${params.contractName}" found ${params.highRisks} high, ${params.mediumRisks} medium, ${params.lowRisks} low risks`,
      type: NotificationType.BOTH,
      relatedEntityType: 'contract',
      relatedEntityId: params.contractId,
      email: {
        to: params.userEmail,
        subject: `Sign — Risk analysis complete: ${params.contractName}`,
        html: templates.riskAnalysisCompleteEmail({
          userName: params.userName,
          contractName: params.contractName,
          projectName: params.projectName,
          highRisks: params.highRisks,
          mediumRisks: params.mediumRisks,
          lowRisks: params.lowRisks,
          contractLink,
        }),
        templateName: 'risk-analysis-complete',
      },
    });
  }

  /**
   * 8. Support ticket created
   */
  async sendSupportTicketCreated(params: {
    userId: string;
    userEmail: string;
    userName: string;
    ticketId: string;
    subject: string;
    category: string;
    priority: string;
    frontendUrl: string;
  }): Promise<void> {
    const ticketLink = `${params.frontendUrl}/app/support`;

    await this.dispatch({
      userId: params.userId,
      title: 'Support Ticket Created',
      message: `Your ticket "${params.subject}" has been submitted`,
      type: NotificationType.BOTH,
      relatedEntityType: 'support_ticket',
      relatedEntityId: params.ticketId,
      email: {
        to: params.userEmail,
        subject: `Sign — Support ticket created: ${params.subject}`,
        html: templates.supportTicketCreatedEmail({
          userName: params.userName,
          ticketId: params.ticketId,
          subject: params.subject,
          category: params.category,
          priority: params.priority,
          ticketLink,
        }),
        templateName: 'support-ticket-created',
      },
    });
  }

  /**
   * 9. Operations review needed (internal)
   */
  async sendOperationsReviewNeeded(params: {
    operationsUserId: string;
    operationsEmail: string;
    operationsUserName: string;
    entityType: 'contract' | 'risk_escalation' | 'support_ticket' | 'knowledge_asset';
    entityName: string;
    entityId: string;
    organizationName: string;
    urgency: 'low' | 'medium' | 'high';
    reason: string;
    frontendUrl: string;
  }): Promise<void> {
    const reviewPaths: Record<string, string> = {
      contract: `/admin/dashboard`,
      risk_escalation: `/admin/dashboard`,
      support_ticket: `/admin/support`,
      knowledge_asset: `/admin/knowledge-assets`,
    };
    const reviewLink = `${params.frontendUrl}${reviewPaths[params.entityType]}`;

    await this.dispatch({
      userId: params.operationsUserId,
      title: 'Review Required',
      message: `[${params.urgency.toUpperCase()}] ${params.entityName} from ${params.organizationName} needs review: ${params.reason}`,
      type: NotificationType.BOTH,
      relatedEntityType: params.entityType,
      relatedEntityId: params.entityId,
      email: {
        to: params.operationsEmail,
        subject: `Sign [${params.urgency.toUpperCase()}] — Review needed: ${params.entityName}`,
        html: templates.operationsReviewNeededEmail({
          operationsUserName: params.operationsUserName,
          entityType: params.entityType,
          entityName: params.entityName,
          organizationName: params.organizationName,
          urgency: params.urgency,
          reason: params.reason,
          reviewLink,
        }),
        templateName: 'operations-review-needed',
      },
    });
  }
}
