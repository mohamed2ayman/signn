import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccountType } from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { ExportService } from '../../export/export.service';

/**
 * Feature #3 — Guest Watermarked Download (visible deterrent).
 *
 * `GET /guest/contracts/:id/pdf` — a bound guest with established identity
 * (account_type=GUEST, "Path B") downloads a PDF of THEIR contract, stamped on
 * EVERY page with a visible watermark `CONFIDENTIAL — <guest email> — <time>`.
 *
 * Protection mirrors GuestCommentsController EXACTLY:
 *  • JwtAuthGuard — standard "Authorization: Bearer <jwt>". A passwordless
 *    viewer credential ("Authorization: Viewer <token>", Path A) is NOT a JWT
 *    and never authenticates here — download REQUIRES established identity.
 *  • Explicit `account_type === GUEST` assertion — a managing-user JWT routed
 *    here gets a clear 403 instead of silently downloading through the wrong
 *    path.
 *  • Contract scope is walled inside ContractAccessService.findAccessibleContract
 *    → findForGuest (the guest_contract_access binding). A guest requesting any
 *    contract they are not bound to gets 404 — never 403 — so existence is not
 *    leaked (the standing no-existence-leak rule).
 *
 * IDENTITY IS SERVER-SIDE ONLY. The stamp's email is taken from the
 * authenticated principal (JwtStrategy.validate loads the User row from the DB
 * by the token `sub`; the email is never read from the request body or query).
 * The route accepts NO identity input of any kind.
 *
 * Renders via ExportService.generateContractPdf — which emits ONLY contract
 * metadata + clauses (no risk data, no obligations, no comments, no internal
 * notes), a strict subset of what the guest already reads on screen. The
 * risk-report and summary exports are deliberately NOT exposed to guests
 * (Portal Rule 6 gates that detail behind upgrade).
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestDownloadController {
  constructor(
    private readonly contractAccess: ContractAccessService,
    private readonly exportService: ExportService,
  ) {}

  @Get(':id/pdf')
  async downloadContractPdf(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    // Only guest-user identities may use this path. A viewer credential (Path A)
    // never reaches here (JwtAuthGuard accepts Bearer JWTs only); a managing-user
    // JWT is rejected loudly rather than silently downloading.
    if (user?.account_type !== AccountType.GUEST) {
      throw new ForbiddenException('Guest download endpoint requires a guest identity');
    }

    // Binding wall — findForGuest throws NotFoundException (404) when no
    // guest_contract_access row binds this guest to this contract. Cross-contract
    // requests therefore 404, never 403.
    await this.contractAccess.findAccessibleContract(contractId, {
      id: user.id,
      organization_id: user.organization_id ?? null,
      role: user.role,
      account_type: user.account_type,
    });

    // Stamp built ENTIRELY from the server-side principal + server clock. The
    // email is the DB-authoritative value JwtStrategy loaded; no client input.
    const stamp = `CONFIDENTIAL — ${user.email} — ${new Date().toUTCString()}`;

    const buffer = await this.exportService.generateContractPdf(contractId, stamp);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="contract-${contractId}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
