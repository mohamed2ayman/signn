import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { GuestCommentDraftDto } from '../dto/establish-identity.dto';

/**
 * Phase 7.18 bucket 1b-ii — write path for an upgraded guest-user.
 *
 * `POST /guest/contracts/:id/comments` — JWT-guarded (standard JWT
 * carrying account_type=GUEST). This is the ONLY contract-write path
 * a guest can use in bucket 1; managing-portal endpoints stay walled
 * by their existing class-level PermissionLevelGuard which throws 403
 * on non-ProjectMember callers.
 *
 * Viewer credentials are NEVER accepted here — the only way in is a
 * standard JWT (established identity). This is enforced two ways:
 *  • JwtAuthGuard rejects "Authorization: Viewer <token>" — passport-
 *    jwt only extracts "Bearer <jwt>".
 *  • The guest-surface gate (unified membership): GUEST accounts pass;
 *    any other account needs a guest_contract_access binding for the
 *    target contract — otherwise a uniform 404 (never 403).
 *
 * Authorization for the contract scope itself flows through the 1a
 * authority inside GuestInvitationService.writeGuestComment — a guest
 * is allowed ONLY on the contract their guest_contract_access binding
 * points at. Anything else → 404.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestCommentsController {
  constructor(
    private readonly invitations: GuestInvitationService,
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Guest Portal comments-list (feature #1) — the guest-VISIBLE conversation
   * on their bound contract (their comments + SIGN-team replies explicitly
   * marked guest-visible). Guarded identically to the POST: a standard JWT
   * with account_type=GUEST only; the contract scope is walled inside the
   * service to the guest's binding (404 otherwise). Internal SIGN-team notes
   * are never returned (service-level whitelist), and the author projection
   * is scrubbed (display name + guest/team flag only).
   */
  @Get(':id/comments')
  async listComments(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    // Guest-surface gate (unified membership) — GUEST accounts pass; any
    // other account needs a binding for THIS contract. Uniform 404, never 403.
    await this.contractAccess.assertGuestSurfaceCaller(user, contractId);
    return this.invitations.readGuestVisibleComments(contractId, user.id);
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  async addComment(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: GuestCommentDraftDto,
    @CurrentUser() user: any,
  ) {
    // Guest-surface gate (unified membership) — GUEST accounts pass; a real
    // account (MANAGING/FREE) posts here ONLY with a binding for THIS
    // contract (a host-org member without a binding still uses the normal
    // /contracts/:id/comments path). Uniform 404, never 403.
    await this.contractAccess.assertGuestSurfaceCaller(user, contractId);
    if (!dto?.content || dto.content.trim().length === 0) {
      throw new BadRequestException('Comment content is required');
    }

    const created = await this.invitations.writeGuestComment(
      contractId,
      user.id,
      dto.content,
      dto.contract_clause_id,
      dto.parent_comment_id,
    );

    // Scrub the response to least-privilege fields. The raw ContractComment
    // entity carries is_internal_note / user_id / is_resolved / parent_comment_id
    // — none of which a guest should ever receive. The guest UI supplies the
    // author label locally (the poster is always this guest).
    return {
      id: created.id,
      contract_id: created.contract_id,
      contract_clause_id: created.contract_clause_id ?? null,
      content: created.content,
      created_at: created.created_at,
    };
  }
}
