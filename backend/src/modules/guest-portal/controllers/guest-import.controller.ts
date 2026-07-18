import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ImportSharedContractDto } from '../dto/import-shared-contract.dto';
import { GuestImportService } from '../services/guest-import.service';

/**
 * Feature #8d — "Import to my workspace".
 *
 * `POST /guest/contracts/:id/import` — a caller holding a
 * guest_contract_access binding to :id copies the contract into a project in
 * THEIR OWN org. Mirrors the JWT-gated guest controllers (guest-upload /
 * guest-comments): class-level `JwtAuthGuard`, identity taken ENTIRELY from
 * the server-side principal, never from client input. A passwordless Viewer
 * credential (Path A — not a JWT) never authenticates here.
 *
 * Authorization is BINDING-ALONE and lives in the SERVICE
 * (`assertGuestContractAccess` first — 404, uniform, no existence oracle;
 * then the guest-scoped read; then destination-project org ownership).
 * No `assertGuestSurfaceCaller` here: that gate passes GUEST accounts
 * without a binding check, and import requires the binding for EVERY
 * account type (the locked #8d decision).
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestImportController {
  constructor(private readonly guestImport: GuestImportService) {}

  @Post(':id/import')
  @HttpCode(HttpStatus.CREATED)
  async importContract(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: ImportSharedContractDto,
    @CurrentUser() user: any,
  ) {
    // A principal without an id (e.g. a viewer-shaped object injected by a
    // misconfigured guard) is not an authenticated user for this route —
    // same posture as guest-my-contracts.
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    return this.guestImport.importSharedContract({
      contractId,
      caller: user,
      destinationProjectId: dto.destinationProjectId,
    });
  }
}
