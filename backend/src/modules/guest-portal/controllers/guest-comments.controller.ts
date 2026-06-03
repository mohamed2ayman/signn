import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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

    return this.invitations.writeGuestComment(
      contractId,
      user.id,
      dto.content,
      dto.contract_clause_id,
      dto.parent_comment_id,
    );
  }
}
