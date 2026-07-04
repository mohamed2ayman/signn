import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ThrottleOnly } from '../../../common/decorators/throttle-only.decorator';
import { AccountType } from '../../../database/entities/user.entity';
import { GuestChatService } from '../services/guest-chat.service';
import { SendGuestChatMessageDto } from '../dto/send-guest-chat-message.dto';

/**
 * Guest chat Slice 1 — Path-B-only multi-turn AI chat routes.
 *
 * Grain (mirrors guest-comments/guest-upload):
 *   - class-level JwtAuthGuard: only a real guest JWT (Bearer) authenticates;
 *     a passwordless Path-A viewer credential (`Authorization: Viewer …`) is
 *     not a JWT and never reaches these handlers.
 *   - explicit `account_type === GUEST` assertion as the FIRST statement of
 *     every handler: a managing-user JWT routed here gets a loud 403, never
 *     a silent answer (belt-and-braces, per the guest-portal grain).
 *   - EVERY route resolves the contract through the guest binding wall
 *     inside GuestChatService (404-not-403 on any miss).
 *   - the burst throttle (`guest_ai_query`, per-IP) sits on the message-send
 *     route only — the expensive one; the 20/day-per-contract cap is
 *     enforced in the service by the atomic daily counter.
 */
@Controller('guest/contracts')
@UseGuards(JwtAuthGuard)
export class GuestChatController {
  constructor(private readonly guestChat: GuestChatService) {}

  private assertGuest(user: any): void {
    if (user?.account_type !== AccountType.GUEST) {
      throw new ForbiddenException(
        'Guest chat endpoint requires a guest identity',
      );
    }
  }

  @Post(':id/chat/sessions')
  async createSession(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
  ) {
    this.assertGuest(user);
    return this.guestChat.createSession(contractId, user);
  }

  /** Session history for resume. */
  @Get(':id/chat/sessions/:sid')
  async getSession(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('sid', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: any,
  ) {
    this.assertGuest(user);
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
    this.assertGuest(user);
    return this.guestChat.sendMessage(contractId, sessionId, user, dto.message);
  }

  @Get(':id/chat/messages/:mid/status')
  async getMessageStatus(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('mid', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: any,
  ) {
    this.assertGuest(user);
    return this.guestChat.getMessageStatus(contractId, messageId, user);
  }
}
