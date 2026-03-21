import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  teamInvitationEmail,
  approvalRequestedEmail,
} from './templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private sesClient: SESClient;
  private readonly isProduction: boolean;
  readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    this.fromEmail = this.configService.get<string>(
      'EMAIL_FROM',
      'noreply@signplatform.com',
    );

    if (this.isProduction) {
      this.sesClient = new SESClient({
        region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
          secretAccessKey: this.configService.get<string>(
            'AWS_SECRET_ACCESS_KEY',
            '',
          ),
        },
      });
    } else {
      // Dev mode: use Ethereal or local SMTP (MailHog, etc.)
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST', 'localhost'),
        port: this.configService.get<number>('SMTP_PORT', 1025),
        secure: false,
        ignoreTLS: true,
        auth: {
          user: this.configService.get<string>('SMTP_USER', ''),
          pass: this.configService.get<string>('SMTP_PASS', ''),
        },
      });
    }
  }

  async sendMfaOtp(email: string, otpCode: string): Promise<void> {
    const { baseEmailLayout } = require('./templates/base-layout');
    const subject = 'Sign — Your Verification Code';
    const html = baseEmailLayout(`
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your Verification Code</h1>
      <p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">Use the following code to complete your login:</p>
      <div style="background-color:#F8FAFF; border-radius:12px; padding:24px; text-align:center; margin:24px 0;">
        <span style="font-size:36px; font-weight:700; color:#4F6EF7; letter-spacing:10px; font-family:monospace;">${otpCode}</span>
      </div>
      <p style="margin:12px 0; font-size:14px; color:#4B5563;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF;">If you did not request this code, please ignore this email.</p>
    `, { preheader: 'Your Sign verification code' });

    await this.sendGenericEmail(email, subject, html);
  }

  async sendInvitation(
    email: string,
    invitationToken: string,
    role: string,
  ): Promise<void> {
    const invitationLink = `${this.frontendUrl}/auth/accept-invitation?token=${invitationToken}`;
    const subject = 'Sign — You Have Been Invited';
    const html = teamInvitationEmail({
      organizationName: 'your organization',
      role,
      inviterName: 'A team member',
      invitationLink,
    });

    await this.sendGenericEmail(email, subject, html);
  }

  async sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const { baseEmailLayout } = require('./templates/base-layout');
    const resetLink = `${this.frontendUrl}/auth/reset-password?token=${resetToken}`;
    const subject = 'Sign — Password Reset Request';
    const html = baseEmailLayout(`
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Password Reset</h1>
      <p style="margin:12px 0; font-size:14px; color:#4B5563; line-height:1.6;">We received a request to reset your password. Click the button below to set a new one:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${resetLink}" style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">Reset Password</a>
        </td></tr>
      </table>
      <p style="margin:12px 0; font-size:14px; color:#4B5563;">This link expires in <strong>1 hour</strong>.</p>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
    `, { preheader: 'Reset your Sign password' });

    await this.sendGenericEmail(email, subject, html);
  }

  async sendContractApprovalRequest(
    email: string,
    contractName: string,
    projectName: string,
  ): Promise<void> {
    const subject = `Sign — Approval required: ${contractName}`;
    const html = approvalRequestedEmail({
      reviewerName: '',
      contractName,
      projectName,
      requesterName: 'A team member',
      contractLink: `${this.frontendUrl}/app/dashboard`,
    });

    await this.sendGenericEmail(email, subject, html);
  }

  async sendGenericEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    try {
      if (this.isProduction) {
        await this.sendViaSes(to, subject, html);
      } else {
        await this.sendViaSmtp(to, subject, html);
      }
      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      // Do not throw - email failures should not break the auth flow
    }
  }

  private async sendViaSmtp(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromEmail,
      to,
      subject,
      html,
    });
  }

  private async sendViaSes(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const command = new SendEmailCommand({
      Source: this.fromEmail,
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: html,
            Charset: 'UTF-8',
          },
        },
      },
    });

    await this.sesClient.send(command);
  }
}
