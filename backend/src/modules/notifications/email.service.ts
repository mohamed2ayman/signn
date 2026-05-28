import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  teamInvitationEmail,
  approvalRequestedEmail,
} from './templates';
import { baseEmailLayout } from './templates/base-layout';
import {
  EMAIL_PROVIDER,
  IEmailProvider,
} from './interfaces/email-provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  /** Used by callers that build links (e.g. invitation, password-reset). */
  readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
  ) {
    this.frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    // Fixed: was incorrectly reading 'EMAIL_FROM'; the Joi-validated key is 'FROM_EMAIL'.
    this.fromEmail = this.configService.get<string>(
      'FROM_EMAIL',
      'noreply@sign.ai',
    );
  }

  // ─── High-level send methods ──────────────────────────────────────────────
  // All template rendering happens here. Providers receive only rendered HTML.

  async sendMfaOtp(email: string, otpCode: string): Promise<void> {
    const subject = 'Sign — Your Verification Code';
    const html = baseEmailLayout(
      `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your Verification Code</h1>
      <p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">Use the following code to complete your login:</p>
      <div style="background-color:#F8FAFF; border-radius:12px; padding:24px; text-align:center; margin:24px 0;">
        <span style="font-size:36px; font-weight:700; color:#4F6EF7; letter-spacing:10px; font-family:monospace;">${otpCode}</span>
      </div>
      <p style="margin:12px 0; font-size:14px; color:#4B5563;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF;">If you did not request this code, please ignore this email.</p>
    `,
      { preheader: 'Your Sign verification code' },
    );

    try {
      await this.sendGenericEmail(email, subject, html);
    } catch (error) {
      this.logger.error(`sendMfaOtp failed for ${email}`, error);
      // Best-effort — MFA OTP email failure must not block the auth flow.
    }
  }

  async sendMfaRecoveryCodes(
    email: string,
    recoveryCodes: string[],
    method: string,
  ): Promise<void> {
    const subject = 'Sign — Your MFA Recovery Codes';
    const codesHtml = recoveryCodes
      .map(
        (code) =>
          `<div style="display:inline-block; background:#F8FAFF; border:1px solid #E2E8F0; border-radius:6px; padding:8px 16px; margin:4px; font-family:monospace; font-size:14px; font-weight:600; color:#0F1729; letter-spacing:2px;">${code}</div>`,
      )
      .join('');

    const html = baseEmailLayout(
      `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Two-Factor Authentication Enabled</h1>
      <p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">
        You have successfully enabled two-factor authentication (${method === 'totp' ? 'Authenticator App' : 'Email OTP'}) on your Sign account.
      </p>
      <div style="background:#FEF3C7; border:1px solid #FCD34D; border-radius:10px; padding:16px; margin:20px 0;">
        <p style="margin:0 0 6px; font-size:13px; font-weight:700; color:#92400E;">⚠️ Save these recovery codes</p>
        <p style="margin:0; font-size:13px; color:#92400E; line-height:1.5;">
          Each code can only be used once to access your account if you lose your MFA device. Store them somewhere safe — this is the only time they will be shown.
        </p>
      </div>
      <div style="text-align:center; margin:24px 0;">${codesHtml}</div>
      <p style="margin:12px 0; font-size:12px; color:#9CA3AF; text-align:center;">
        If you did not enable MFA on your account, please contact support immediately.
      </p>
    `,
      { preheader: 'Your Sign MFA recovery codes — save them now' },
    );

    try {
      await this.sendGenericEmail(email, subject, html);
    } catch (error) {
      this.logger.error(`sendMfaRecoveryCodes failed for ${email}`, error);
      // Best-effort — recovery-codes email failure must not block MFA setup.
    }
  }

  async sendInvitation(
    email: string,
    invitationToken: string,
    role: string,
    organizationName: string,
    inviterName: string,
  ): Promise<void> {
    const invitationLink = `${this.frontendUrl}/auth/accept-invitation?token=${invitationToken}`;
    const subject = 'Sign — You Have Been Invited';
    const html = teamInvitationEmail({
      organizationName,
      role,
      inviterName,
      invitationLink,
    });

    try {
      await this.sendGenericEmail(email, subject, html);
    } catch (error) {
      this.logger.error(`sendInvitation failed for ${email}`, error);
      // Best-effort — invitation email failure must not block user creation.
    }
  }

  async sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const resetLink = `${this.frontendUrl}/auth/reset-password?token=${resetToken}`;
    const subject = 'Sign — Password Reset Request';
    const html = baseEmailLayout(
      `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Password Reset</h1>
      <p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">We received a request to reset your password. Click the button below to set a new one:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${resetLink}" style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">Reset Password</a>
        </td></tr>
      </table>
      <p style="margin:12px 0; font-size:14px; color:#4B5563;">This link expires in <strong>1 hour</strong>.</p>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
    `,
      { preheader: 'Reset your Sign password' },
    );

    try {
      await this.sendGenericEmail(email, subject, html);
    } catch (error) {
      this.logger.error(`sendPasswordReset failed for ${email}`, error);
      // Best-effort — password-reset email failure must not break the forgot-password flow.
    }
  }

  async sendContractApprovalRequest(
    email: string,
    contractName: string,
    projectName: string,
    requesterName?: string,
    contractId?: string,
  ): Promise<void> {
    const subject = `Sign — Approval required: ${contractName}`;
    const contractLink = contractId
      ? `${this.frontendUrl}/app/contracts/${contractId}`
      : `${this.frontendUrl}/app/approvals`;

    const html = approvalRequestedEmail({
      reviewerName: '',
      contractName,
      projectName,
      requesterName: requesterName || 'A team member',
      contractLink,
    });

    try {
      await this.sendGenericEmail(email, subject, html);
    } catch (error) {
      this.logger.error(`sendContractApprovalRequest failed for ${email}`, error);
      // Best-effort — approval-request email failure must not block the approval workflow.
    }
  }

  // ─── Transport dispatch ───────────────────────────────────────────────────

  /**
   * Single transport dispatch point for all outbound email.
   * Delegates to the injected IEmailProvider and THROWS on failure.
   *
   * Callers fall into two categories:
   *
   * 1. Bull queue processor (EmailQueueProcessor.handleSendEmail):
   *    Calls sendGenericEmail directly — receives the thrown error,
   *    re-throws it, and Bull retries the job based on queue config.
   *
   * 2. High-level convenience methods (sendMfaOtp, sendPasswordReset, etc.):
   *    Each wraps this call in its own try/catch so that email failure
   *    never breaks the calling auth/user flow (best-effort semantics).
   *
   * Direct callers that already have their own try/catch (e.g. DocuSign service)
   * continue to work correctly — their catch blocks now actually execute.
   */
  async sendGenericEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    await this.provider.send({ from: this.fromEmail, to, subject, html });
    this.logger.log(`Email sent successfully to ${to}`);
  }
}
