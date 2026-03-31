import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { DocuSignService } from './docusign.service';

@Controller('docusign')
export class DocuSignWebhookController {
  private readonly logger = new Logger(DocuSignWebhookController.name);

  constructor(private readonly docusignService: DocuSignService) {}

  /**
   * DocuSign Connect webhook endpoint.
   * This is unauthenticated since DocuSign calls it directly.
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() payload: any) {
    this.logger.log('DocuSign webhook received');
    try {
      await this.docusignService.handleWebhook(payload);
    } catch (err) {
      this.logger.error('DocuSign webhook processing error', err);
      // Still return 200 to prevent DocuSign from retrying
    }
    return { received: true };
  }
}
