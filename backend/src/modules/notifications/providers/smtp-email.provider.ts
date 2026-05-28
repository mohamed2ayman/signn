import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { IEmailProvider } from '../interfaces/email-provider.interface';

/**
 * SMTP email transport (default: EMAIL_DRIVER=smtp).
 * Used in development with MailHog, Mailtrap, or any SMTP server.
 */
export class SmtpEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(config: {
    host: string;
    port: number;
    user: string;
    pass: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      ignoreTLS: true,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  async send(params: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    this.logger.debug(`SMTP delivered → ${params.to}`);
  }
}
