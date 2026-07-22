import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ThrottleOnly } from '../../../common/decorators/throttle-only.decorator';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestChatService } from '../services/guest-chat.service';
import { SendGuestChatMessageDto } from '../dto/send-guest-chat-message.dto';

/**
 * Guest chat Slice 1 — Path-B-only multi-turn AI chat routes.
 *
 * Grain (mirrors guest-comments/guest-upload):
 *   - class-level JwtAuthGuard: only a real guest JWT (Bearer) authenticates;
 *     a passwordless Path-A viewer credential (`Authorization: Viewer …`) is
 *     not a JWT and never reaches these handlers.
 *   - the guest-surface gate as the FIRST statement of every handler
 *     (unified membership): GUEST accounts pass; any other account needs a
 *     guest_contract_access binding for the target contract — otherwise a
 *     uniform 404, never a silent answer (belt-and-braces, guest-portal grain).
 *   - EVERY route resolves the contract through the guest binding wall
 *     inside GuestChatService (404-not-403 on any miss).
 *   - the burst throttle (`guest_ai_query`, per-IP) sits on the message-send
 *     route only — the expensive one; the 20/day-per-contract cap is
 *     enforced in the service by the atomic daily counter.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestChatController {
  constructor(
    private readonly guestChat: GuestChatService,
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Guest-surface gate (unified membership) — GUEST accounts pass; any other
   * account needs a guest_contract_access binding for THIS contract. Denial
   * is a uniform 404 (never 403 — no existence oracle).
   */
  private assertGuestSurface(user: any, contractId: string): Promise<void> {
    return this.contractAccess.assertGuestSurfaceCaller(user, contractId);
  }

  @Post(':id/chat/sessions')
  async createSession(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    await this.assertGuestSurface(user, contractId);
    return this.guestChat.createSession(contractId, user);
  }

  /**
   * List the caller's sessions for this contract (#8c chat-resume). Powers
   * server-side rediscovery when the localStorage pointer is gone (fresh
   * device / cleared storage). Most-recent-first, sanitized (no bodies).
   * Distinct path from :sid below — a bare /sessions never carries a session
   * segment, so there is no route shadowing.
   */
  @Get(':id/chat/sessions')
  async listSessions(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    await this.assertGuestSurface(user, contractId);
    return this.guestChat.listSessions(contractId, user);
  }

  /** Session history for resume. */
  @Get(':id/chat/sessions/:sid')
  async getSession(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('sid', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: any,
  ) {
    await this.assertGuestSurface(user, contractId);
    return this.guestChat.getSession(contractId, sessionId, user);
  }

  @Post(':id/chat/sessions/:sid/messages')
  @ThrottleOnly('guest_ai_query')
  async sendMessage(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('sid', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendGuestChatMessageDto,
    @CurrentUser() user: any,
  ) {
    await this.assertGuestSurface(user, contractId);
    return this.guestChat.sendMessage(contractId, sessionId, user, dto.message);
  }

  @Get(':id/chat/messages/:mid/status')
  async getMessageStatus(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('mid', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: any,
  ) {
    await this.assertGuestSurface(user, contractId);
    return this.guestChat.getMessageStatus(contractId, messageId, user);
  }
}
