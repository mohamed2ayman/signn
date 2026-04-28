import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseDocxService, ParseDocxResult } from './parse-docx.service';

/**
 * Endpoint used by the SIGN Word Add-in to parse a Word document into clauses
 * with character/paragraph boundaries for in-document highlighting.
 *
 * Accepts EITHER:
 *   - multipart `file` field with a .docx upload, OR
 *   - JSON `{ text: string }` (plain-text fallback from Word JS API
 *     `context.document.body.getText()`).
 *
 * NOTE — Soft Rule 2 trade-off:
 * This endpoint blocks the request handler while it polls the AI backend's
 * extract-clauses job (single in-flight Celery task). It does NOT block the
 * Node event loop (async/await on HTTP), but it does keep the HTTP request
 * open for up to ~60s. Accepted because Decision 2 of the Word Add-in plan
 * requires server-side clause boundaries returned atomically with clauses,
 * and we ship local-only for now. Pre-deployment refactor: split into POST
 * (returns job_id) + GET (returns augmented result) using a Redis-backed
 * boundary cache keyed by job_id.
 */
@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ParseDocxController {
  constructor(private readonly parseDocxService: ParseDocxService) {}

  @Post('parse-from-docx')
  @UseInterceptors(FileInterceptor('file'))
  async parseFromDocx(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { text?: string; contract_type?: string },
    @CurrentUser('id') userId: string,
    @OrganizationId() orgId: string,
  ): Promise<ParseDocxResult> {
    if (!file && !body?.text) {
      throw new BadRequestException(
        'Either a multipart `file` field or a JSON `text` field is required.',
      );
    }

    return this.parseDocxService.parse({
      file: file ?? null,
      text: body?.text ?? null,
      contract_type: body?.contract_type,
      org_id: orgId,
      user_id: userId,
    });
  }
}
