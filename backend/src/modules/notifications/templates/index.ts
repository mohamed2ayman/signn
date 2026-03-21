/**
 * Email Template Registry
 * ═══════════════════════════════════════════════════════════
 * 9 branded email templates for the Sign platform.
 * Each template returns fully-formed HTML using the base layout.
 * ═══════════════════════════════════════════════════════════
 */

import { baseEmailLayout } from './base-layout';

const BRAND_COLOR = '#4F6EF7';

// ─── Helpers ──────────────────────────────────────────────

function infoBlock(pairs: [string, string][]): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFF; border-radius:10px; margin:20px 0;">
      ${pairs
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:10px 16px;">
            <span style="font-size:12px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">${label}</span><br/>
            <span style="font-size:14px; color:#0F1729; font-weight:600;">${value}</span>
          </td>
        </tr>`,
        )
        .join('')}
    </table>`;
}

function ctaButton(text: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
      <tr>
        <td align="center">
          <a href="${url}" class="btn" style="display:inline-block; padding:14px 32px; background-color:${BRAND_COLOR}; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">${text}</a>
        </td>
      </tr>
    </table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729; line-height:1.3;">${text}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">${text}</p>`;
}

function smallNote(text: string): string {
  return `<p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">${text}</p>`;
}

// ─── 1. Team Invitation ──────────────────────────────────

export function teamInvitationEmail(data: {
  recipientName?: string;
  organizationName: string;
  role: string;
  inviterName: string;
  invitationLink: string;
}): string {
  const content = `
    ${heading("You've Been Invited!")}
    ${paragraph(`${data.inviterName} has invited you to join <strong>${data.organizationName}</strong> on Sign as a <strong>${data.role}</strong>.`)}
    ${paragraph('Sign is a smart contract management platform powered by AI. Accept your invitation to get started.')}
    ${ctaButton('Accept Invitation', data.invitationLink)}
    ${smallNote('This invitation expires in 48 hours. If you did not expect this invitation, you can safely ignore this email.')}
  `;
  return baseEmailLayout(content, { preheader: `${data.inviterName} invited you to ${data.organizationName}` });
}

// ─── 2. Contractor Invitation ────────────────────────────

export function contractorInvitationEmail(data: {
  contractorEmail: string;
  projectName: string;
  organizationName: string;
  role: string;
  inviterName: string;
  invitationLink: string;
}): string {
  const content = `
    ${heading('Project Collaboration Invite')}
    ${paragraph(`<strong>${data.inviterName}</strong> from <strong>${data.organizationName}</strong> has invited you to collaborate on a project as a <strong>${data.role}</strong>.`)}
    ${infoBlock([
      ['Project', data.projectName],
      ['Organization', data.organizationName],
      ['Your Role', data.role],
    ])}
    ${ctaButton('View & Accept', data.invitationLink)}
    ${smallNote('This invitation expires in 7 days. If you did not expect this, please ignore this email.')}
  `;
  return baseEmailLayout(content, { preheader: `Collaboration invite for ${data.projectName}` });
}

// ─── 3. Approval Requested ──────────────────────────────

export function approvalRequestedEmail(data: {
  reviewerName: string;
  contractName: string;
  projectName: string;
  requesterName: string;
  contractLink: string;
}): string {
  const content = `
    ${heading('Approval Required')}
    ${paragraph(`Hi ${data.reviewerName}, <strong>${data.requesterName}</strong> has submitted a contract for your review and approval.`)}
    ${infoBlock([
      ['Contract', data.contractName],
      ['Project', data.projectName],
      ['Requested By', data.requesterName],
    ])}
    ${ctaButton('Review Contract', data.contractLink)}
    ${smallNote('Please review and respond at your earliest convenience.')}
  `;
  return baseEmailLayout(content, { preheader: `${data.contractName} needs your approval` });
}

// ─── 4. Approval Decision ───────────────────────────────

export function approvalDecisionEmail(data: {
  requesterName: string;
  contractName: string;
  projectName: string;
  reviewerName: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  comments?: string;
  contractLink: string;
}): string {
  const decisionLabels: Record<string, { label: string; color: string; icon: string }> = {
    approved: { label: 'Approved', color: '#059669', icon: '✓' },
    rejected: { label: 'Rejected', color: '#DC2626', icon: '✕' },
    changes_requested: { label: 'Changes Requested', color: '#D97706', icon: '⟲' },
  };
  const d = decisionLabels[data.decision];

  const content = `
    ${heading('Contract Review Decision')}
    ${paragraph(`Hi ${data.requesterName}, <strong>${data.reviewerName}</strong> has reviewed your contract.`)}
    <div style="text-align:center; margin:20px 0;">
      <span style="display:inline-block; padding:8px 20px; background-color:${d.color}15; color:${d.color}; font-size:15px; font-weight:700; border-radius:8px; letter-spacing:0.3px;">
        ${d.icon} &nbsp;${d.label}
      </span>
    </div>
    ${infoBlock([
      ['Contract', data.contractName],
      ['Project', data.projectName],
      ['Reviewed By', data.reviewerName],
    ])}
    ${data.comments ? `<div style="background-color:#FFFBEB; border-left:3px solid #D97706; padding:12px 16px; border-radius:0 8px 8px 0; margin:16px 0;"><p style="margin:0; font-size:13px; color:#92400E; font-weight:600;">Reviewer Comments:</p><p style="margin:6px 0 0; font-size:14px; color:#78350F;">${data.comments}</p></div>` : ''}
    ${ctaButton('View Contract', data.contractLink)}
  `;
  return baseEmailLayout(content, { preheader: `${data.contractName} — ${d.label} by ${data.reviewerName}` });
}

// ─── 5. Contract Shared ─────────────────────────────────

export function contractSharedEmail(data: {
  recipientName?: string;
  contractName: string;
  sharedByName: string;
  permission: string;
  expiresAt?: string;
  shareLink: string;
}): string {
  const content = `
    ${heading('Contract Shared With You')}
    ${paragraph(`${data.recipientName ? `Hi ${data.recipientName}, ` : ''}<strong>${data.sharedByName}</strong> has shared a contract with you.`)}
    ${infoBlock([
      ['Contract', data.contractName],
      ['Shared By', data.sharedByName],
      ['Permission', data.permission],
      ...(data.expiresAt ? [['Expires', data.expiresAt] as [string, string]] : []),
    ])}
    ${ctaButton('View Contract', data.shareLink)}
    ${smallNote('This is a secure link. Do not forward this email if you want to keep the contract private.')}
  `;
  return baseEmailLayout(content, { preheader: `${data.sharedByName} shared "${data.contractName}" with you` });
}

// ─── 6. Obligation Reminder ─────────────────────────────

export function obligationReminderEmail(data: {
  userName: string;
  obligationDescription: string;
  contractName: string;
  dueDate: string;
  daysRemaining: number;
  obligationLink: string;
}): string {
  const urgencyColor = data.daysRemaining <= 1 ? '#DC2626' : data.daysRemaining <= 3 ? '#D97706' : '#059669';
  const urgencyLabel = data.daysRemaining <= 0 ? 'OVERDUE' : data.daysRemaining === 1 ? 'Due Tomorrow' : `${data.daysRemaining} days remaining`;

  const content = `
    ${heading('Obligation Reminder')}
    ${paragraph(`Hi ${data.userName}, you have an upcoming obligation that requires your attention.`)}
    <div style="text-align:center; margin:16px 0;">
      <span style="display:inline-block; padding:6px 16px; background-color:${urgencyColor}15; color:${urgencyColor}; font-size:13px; font-weight:700; border-radius:20px;">
        ⏰ ${urgencyLabel}
      </span>
    </div>
    ${infoBlock([
      ['Obligation', data.obligationDescription],
      ['Contract', data.contractName],
      ['Due Date', data.dueDate],
    ])}
    ${ctaButton('View Details', data.obligationLink)}
    ${smallNote('You are receiving this because you are assigned to this obligation.')}
  `;
  return baseEmailLayout(content, { preheader: `Obligation due: ${data.obligationDescription}` });
}

// ─── 7. Risk Analysis Complete ──────────────────────────

export function riskAnalysisCompleteEmail(data: {
  userName: string;
  contractName: string;
  projectName: string;
  highRisks: number;
  mediumRisks: number;
  lowRisks: number;
  contractLink: string;
}): string {
  const totalRisks = data.highRisks + data.mediumRisks + data.lowRisks;

  const content = `
    ${heading('Risk Analysis Complete')}
    ${paragraph(`Hi ${data.userName}, the AI risk analysis for <strong>${data.contractName}</strong> is now complete.`)}
    ${infoBlock([
      ['Contract', data.contractName],
      ['Project', data.projectName],
    ])}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td align="center" style="padding:4px;">
          <div style="background-color:#FEF2F2; border-radius:10px; padding:14px 8px; text-align:center;">
            <div style="font-size:24px; font-weight:700; color:#DC2626;">${data.highRisks}</div>
            <div style="font-size:11px; color:#991B1B; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">High</div>
          </div>
        </td>
        <td align="center" style="padding:4px;">
          <div style="background-color:#FFFBEB; border-radius:10px; padding:14px 8px; text-align:center;">
            <div style="font-size:24px; font-weight:700; color:#D97706;">${data.mediumRisks}</div>
            <div style="font-size:11px; color:#92400E; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Medium</div>
          </div>
        </td>
        <td align="center" style="padding:4px;">
          <div style="background-color:#F0FDF4; border-radius:10px; padding:14px 8px; text-align:center;">
            <div style="font-size:24px; font-weight:700; color:#059669;">${data.lowRisks}</div>
            <div style="font-size:11px; color:#065F46; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Low</div>
          </div>
        </td>
      </tr>
    </table>
    ${data.highRisks > 0 ? `<div style="background-color:#FEF2F2; border-left:3px solid #DC2626; padding:12px 16px; border-radius:0 8px 8px 0; margin:12px 0;"><p style="margin:0; font-size:13px; color:#991B1B; font-weight:600;">⚠️ ${data.highRisks} high-risk ${data.highRisks === 1 ? 'issue requires' : 'issues require'} immediate attention</p></div>` : ''}
    ${ctaButton('Review Risks', data.contractLink)}
  `;
  return baseEmailLayout(content, { preheader: `${totalRisks} risks found in ${data.contractName}` });
}

// ─── 8. Support Ticket Created ──────────────────────────

export function supportTicketCreatedEmail(data: {
  userName: string;
  ticketId: string;
  subject: string;
  category: string;
  priority: string;
  ticketLink: string;
}): string {
  const priorityColors: Record<string, string> = {
    low: '#059669',
    medium: '#D97706',
    high: '#DC2626',
    urgent: '#DC2626',
  };

  const content = `
    ${heading('Support Ticket Created')}
    ${paragraph(`Hi ${data.userName}, your support ticket has been created successfully. Our team will review it shortly.`)}
    ${infoBlock([
      ['Ticket ID', `#${data.ticketId.slice(0, 8).toUpperCase()}`],
      ['Subject', data.subject],
      ['Category', data.category],
      ['Priority', `<span style="color:${priorityColors[data.priority.toLowerCase()] || '#6B7280'}">${data.priority}</span>`],
    ])}
    ${ctaButton('View Ticket', data.ticketLink)}
    ${smallNote('You will receive updates when our team responds to your ticket.')}
  `;
  return baseEmailLayout(content, { preheader: `Support ticket created: ${data.subject}` });
}

// ─── 9. Operations Review Needed ────────────────────────

export function operationsReviewNeededEmail(data: {
  operationsUserName: string;
  entityType: 'contract' | 'risk_escalation' | 'support_ticket' | 'knowledge_asset';
  entityName: string;
  organizationName: string;
  urgency: 'low' | 'medium' | 'high';
  reason: string;
  reviewLink: string;
}): string {
  const urgencyColors = { low: '#059669', medium: '#D97706', high: '#DC2626' };
  const entityLabels = {
    contract: 'Contract',
    risk_escalation: 'Risk Escalation',
    support_ticket: 'Support Ticket',
    knowledge_asset: 'Knowledge Asset',
  };

  const content = `
    ${heading('Review Required')}
    ${paragraph(`Hi ${data.operationsUserName}, an item requires your review and action.`)}
    <div style="text-align:center; margin:16px 0;">
      <span style="display:inline-block; padding:6px 16px; background-color:${urgencyColors[data.urgency]}15; color:${urgencyColors[data.urgency]}; font-size:12px; font-weight:700; border-radius:20px; text-transform:uppercase; letter-spacing:0.5px;">
        ${data.urgency} priority
      </span>
    </div>
    ${infoBlock([
      ['Type', entityLabels[data.entityType]],
      ['Name', data.entityName],
      ['Organization', data.organizationName],
      ['Reason', data.reason],
    ])}
    ${ctaButton('Review Now', data.reviewLink)}
    ${smallNote('You are receiving this because you are assigned as Operations staff.')}
  `;
  return baseEmailLayout(content, { preheader: `[${data.urgency.toUpperCase()}] ${entityLabels[data.entityType]} review needed` });
}
