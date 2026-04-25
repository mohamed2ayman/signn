// Required environment variables for DocuSign integration:
// DOCUSIGN_INTEGRATION_KEY=
// DOCUSIGN_SECRET_KEY=
// DOCUSIGN_ACCOUNT_ID=
// DOCUSIGN_WEBHOOK_HMAC_SECRET=
// Configure webhook URL in DocuSign dashboard → Connect → Add Configuration
// Webhook URL: https://[your-domain]/api/v1/docusign/webhook
// Events to subscribe: envelope-completed, envelope-declined, envelope-voided
import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  Logger,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { DocuSignService } from './docusign.service';

@Controller('docusign')
export class DocuSignWebhookController {
  private readonly logger = new Logger(DocuSignWebhookController.name);

  constructor(
    private readonly docusignService: DocuSignService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * DocuSign Connect webhook endpoint.
   * Unauthenticated — DocuSign calls it directly. We verify with HMAC instead.
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-docusign-signature-1') signatureHeader: string | undefined,
    @Body() payload: any,
  ) {
    const hmacSecret = this.configService.get<string>(
      'DOCUSIGN_WEBHOOK_HMAC_SECRET',
    );

    if (!hmacSecret) {
      this.logger.error(
        'DOCUSIGN_WEBHOOK_HMAC_SECRET is not configured — refusing webhook',
      );
      throw new UnauthorizedException('Webhook signature secret not configured');
    }

    if (!signatureHeader) {
      this.logger.warn('DocuSign webhook missing X-DocuSign-Signature-1 header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // DocuSign signs the raw request body with HMAC-SHA256, base64-encoded.
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    const computed = crypto
      .createHmac('sha256', hmacSecret)
      .update(rawBody)
      .digest('base64');

    const provided = Buffer.from(signatureHeader, 'utf8');
    const expected = Buffer.from(computed, 'utf8');
    const valid =
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected);

    if (!valid) {
      this.logger.warn('DocuSign webhook HMAC signature mismatch');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log('DocuSign webhook received and HMAC verified');
    await this.docusignService.handleWebhook(payload);
    return { received: true };
  }
}
