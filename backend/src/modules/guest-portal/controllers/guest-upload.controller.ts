import {
  BadRequestException,
  Controller,
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
import { ContractAccessService } from '../../contracts/services/contract-access.service';
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
 * class-level `JwtAuthGuard` + the guest-surface gate
 * (`assertGuestSurfaceCaller`) as the first statement, so a passwordless
 * Viewer credential (Path A — not a JWT) can never reach this route, and a
 * real-account JWT is allowed ONLY when it holds a guest_contract_access
 * binding for the target contract (unified membership) — otherwise a uniform
 * 404, never an upload.
 *
 * Network-layer burst protection via `@ThrottleOnly('guest_upload')` is
 * SEPARATE from the 5/day-per-contract daily quota enforced in
 * `GuestUploadService`.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestUploadController {
  constructor(
    private readonly guestUpload: GuestUploadService,
    private readonly contractAccess: ContractAccessService,
  ) {}

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
    // Guest-surface gate (unified membership) — a GUEST account passes (the
    // binding wall downstream still applies); any OTHER account (MANAGING /
    // FREE) must hold a guest_contract_access binding for THIS contract.
    // Denial is a uniform 404 — never 403 — so a real account without a
    // binding can't learn the route recognises the contract. Identity is
    // taken ENTIRELY from the server-side principal (JwtStrategy loaded the
    // User row by token sub), never from client input.
    await this.contractAccess.assertGuestSurfaceCaller(user, contractId);
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
