import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { AccountType } from '../../../database/entities';
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
 * standard JWT for a USER ROW with account_type=GUEST (i.e. a guest
 * that has already established identity). This is enforced two ways:
 *  • JwtAuthGuard rejects "Authorization: Viewer <token>" — passport-
 *    jwt only extracts "Bearer <jwt>".
 *  • An explicit account_type guard below 403s any non-GUEST JWT so a
 *    managing-user JWT cannot accidentally route through this endpoint.
 *
 * Authorization for the contract scope itself flows through the 1a
 * authority inside GuestInvitationService.writeGuestComment — a guest
 * is allowed ONLY on the contract their guest_contract_access binding
 * points at. Anything else → 404.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestCommentsController {
  constructor(private readonly invitations: GuestInvitationService) {}

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
    if (user?.account_type !== AccountType.GUEST) {
      throw new ForbiddenException('Guest comment endpoint requires a guest identity');
    }
    return this.invitations.readGuestVisibleComments(contractId, user.id);
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  async addComment(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: GuestCommentDraftDto,
    @CurrentUser() user: any,
  ) {
    // Belt-and-braces — only guest-user identities may post here.
    // Managing-user JWTs go through the normal /contracts/:id/comments
    // path; sending one here is a misuse worth a clear 403 instead of
    // silently writing through the wrong code path.
    if (user?.account_type !== AccountType.GUEST) {
      throw new ForbiddenException('Guest comment endpoint requires a guest identity');
    }
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
