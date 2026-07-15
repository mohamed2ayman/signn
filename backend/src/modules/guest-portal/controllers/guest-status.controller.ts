import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { DocumentProcessingService } from '../../document-processing/document-processing.service';

/**
 * Guest extraction completion (Slice 1) — guest-gated document status poll.
 *
 * The KEYSTONE for guest extraction: nothing drives the extraction pipeline
 * forward for a guest upload (the managing status route is walled by
 * `findInOrg`, which a guest's null org can never pass). This route is the
 * guest sibling of `GET /contracts/:contractId/documents/:docId/status` — it
 * drives `pollAndAdvanceForGuest`, walled by the guest CONTRACT BINDING
 * (`guest_contract_access`) plus an ownership check that the doc is THIS
 * guest's own upload, instead of `findInOrg`. The managing route is UNTOUCHED.
 *
 * Mirrors the JWT-gated guest controllers (guest-upload / guest-download):
 * class-level `JwtAuthGuard` + the guest-surface gate as the first statement,
 * so a passwordless Viewer credential (Path A — not a JWT) can never reach
 * this route, and a real-account JWT is allowed only with a
 * guest_contract_access binding for the target contract (uniform 404
 * otherwise — unified membership).
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestStatusController {
  constructor(
    private readonly documentProcessing: DocumentProcessingService,
    private readonly contractAccess: ContractAccessService,
  ) {}

  @Get(':id/documents/:docId/status')
  async getDocumentStatus(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: any,
  ) {
    // Guest-surface gate (unified membership) — GUEST accounts pass; any
    // other account needs a binding for THIS contract (uniform 404, never
    // 403). Identity is taken ENTIRELY from the server-side principal
    // (JwtStrategy loaded the User row by token sub), never client input.
    await this.contractAccess.assertGuestSurfaceCaller(user, contractId);

    // Binding + ownership wall + drive the guest pipeline one step.
    const doc = await this.documentProcessing.pollAndAdvanceForGuest(
      docId,
      contractId,
      user.id,
    );

    // Sanitized view — never leak the host org_id / reservation_id /
    // extracted_text to the guest. The guest sees only what the status surface
    // needs to render progress, completion, and failure.
    return {
      id: doc.id,
      processing_status: doc.processing_status,
      quality_flags: doc.quality_flags ?? null,
      error_message: doc.error_message ?? null,
      page_count: doc.page_count ?? null,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    };
  }
}
