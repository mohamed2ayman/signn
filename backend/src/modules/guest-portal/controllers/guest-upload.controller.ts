import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ThrottleOnly } from '../../../common/decorators/throttle-only.decorator';
import { AccountType } from '../../../database/entities';
import {
  ALLOWED_CONTRACT_EXTENSIONS,
  ALLOWED_CONTRACT_MIMES,
  assertAllowedDocumentSignature,
  validateFileType,
} from '../../../common/utils/file-validation';
import { GuestUploadService } from '../services/guest-upload.service';

/**
 * Feature #4 — Guest upload of a new contract version.
 *
 * Mirrors the JWT-gated guest controllers (guest-comments / guest-download):
 * class-level `JwtAuthGuard` + an explicit `account_type === GUEST` assertion
 * as the first statement, so a passwordless Viewer credential (Path A — not a
 * JWT) can never reach this route, and a managing-user JWT routed here gets a
 * loud 403 rather than an upload.
 *
 * Network-layer burst protection via `@ThrottleOnly('guest_upload')` is
 * SEPARATE from the 5/day-per-contract daily quota enforced in
 * `GuestUploadService`.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestUploadController {
  constructor(private readonly guestUpload: GuestUploadService) {}

  @Post(':id/documents')
  @ThrottleOnly('guest_upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadNewVersion(
    @Param('id', ParseUUIDPipe) contractId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    // Path-B identity gate — established guest identity only. Identity is
    // taken ENTIRELY from the server-side principal (JwtStrategy loaded the
    // User row by token sub), never from client input.
    if (user?.account_type !== AccountType.GUEST) {
      throw new ForbiddenException(
        'Guest upload endpoint requires a guest identity',
      );
    }
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    // Request-shape validation (uniform for any contract id — does NOT leak
    // contract existence): declared MIME + extension (spoofable) AND the real
    // leading bytes (magic-bytes) so a disguised payload — e.g. an executable
    // renamed `.pdf` — is rejected before it is ever stored or sent to the AI
    // pipeline.
    validateFileType(
      file,
      ALLOWED_CONTRACT_MIMES,
      ALLOWED_CONTRACT_EXTENSIONS,
      'PDF/DOCX',
    );
    assertAllowedDocumentSignature(file, 'PDF/DOCX');

    return this.guestUpload.guestUploadNewVersion({
      contractId,
      guest: user,
      file: file as any,
    });
  }
}
