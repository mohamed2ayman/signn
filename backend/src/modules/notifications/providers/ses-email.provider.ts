import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { IEmailProvider } from '../interfaces/email-provider.interface';

/**
 * AWS SES email transport (EMAIL_DRIVER=ses).
 * Used in production. Credentials are optional when running on ECS with IRSA.
 */
export class SesEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly sesClient: SESClient;

  constructor(config: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    this.sesClient = new SESClient({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}), // fall back to instance role / IRSA when no explicit credentials
    });
  }

  async send(params: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const command = new SendEmailCommand({
      Source: params.from,
      Destination: {
        ToAddresses: [params.to],
      },
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: params.html, Charset: 'UTF-8' },
        },
      },
    });

    await this.sesClient.send(command);
    this.logger.debug(`SES delivered → ${params.to}`);
  }
}
