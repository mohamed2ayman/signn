import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { OpsAvailabilityStatus } from '../../database/entities';
import { SupportChatService, RequestActor } from './support-chat.service';
import { SupportChatNoteService } from './support-chat-note.service';
import { CannedResponseService } from './canned-response.service';
import { OpsAvailabilityService } from './ops-availability.service';
import { SupportService } from '../support/support.service';
import {
  TransferChatDto,
  CloseChatDto,
  AddNoteDto,
  CreateCannedResponseDto,
  UpdateCannedResponseDto,
  SetAvailabilityDto,
  ConvertToTicketDto,
} from './dto';

const OPS = [UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS] as const;

/**
 * Ops-only Live Chat endpoints. Mounted at /api/v1/admin/support — RolesGuard
 * + JwtAuthGuard restrict every route to SYSTEM_ADMIN / OPERATIONS users.
 */
@Controller('admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...OPS)
export class SupportChatOpsController {
  constructor(
    private readonly chatService: SupportChatService,
    private readonly noteService: SupportChatNoteService,
    private readonly cannedService: CannedResponseService,
    private readonly availabilityService: OpsAvailabilityService,
    private readonly supportService: SupportService,
  ) {}

  private toActor(user: any): RequestActor {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id ?? null,
    };
  }

  // ─── #6 Queue ───────────────────────────────────────────────
  @Get('chat/queue')
  async queue(@CurrentUser() user: any) {
    return this.chatService.getQueue(this.toActor(user));
  }

  /** Convenience: caller's currently ACTIVE chats (drives the Active Chats tab). */
  @Get('chat/active')
  async activeForMe(@CurrentUser() user: any) {
    return this.chatService.getActiveForOps(user.id);
  }

  /** CSAT analytics — feeds the CSAT Analytics tab. */
  @Get('chat/csat-stats')
  async csatStats(@CurrentUser() user: any) {
    return this.chatService.getCsatStats(this.toActor(user));
  }

  /** Available ops for the transfer modal. */
  @Get('availability/online')
  async listOnlineOps(@CurrentUser() user: any) {
    return this.availabilityService.listAvailableOps(this.toActor(user));
  }

  // ─── Per-chat lifecycle (ops side) ──────────────────────────

  /** Same payload as the user GET — kept here so ops can fetch via /admin path
   *  without mixing concerns with the user controller. */
  @Get('chat/:id')
  async getChat(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getChatWithMessages(id, this.toActor(user));
  }

  /** #7 Claim */
  @Post('chat/:id/claim')
  async claim(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.claimChat(id, this.toActor(user));
  }

  /** #8 Transfer */
  @Post('chat/:id/transfer')
  async transfer(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferChatDto,
  ) {
    return this.chatService.transferChat(
      id,
      dto.to_ops_id,
      dto.reason,
      this.toActor(user),
    );
  }

  /** #9 Close */
  @Post('chat/:id/close')
  async close(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseChatDto,
  ) {
    return this.chatService.closeChat(id, dto.reason, this.toActor(user));
  }

  // ─── #10/#11 Notes ──────────────────────────────────────────
  @Post('chat/:id/notes')
  async addNote(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.noteService.addNote(id, this.toActor(user), dto.body);
  }

  @Get('chat/:id/notes')
  async listNotes(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.noteService.listNotes(id, this.toActor(user));
  }

  // ─── #12 Convert to Ticket ──────────────────────────────────
  @Post('chat/:id/convert-to-ticket')
  async convertToTicket(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertToTicketDto,
  ) {
    const actor = this.toActor(user);
    const chat = await this.chatService.getChatById(id, actor);

    if (chat.status !== 'CLOSED') {
      throw new ConflictException(
        'Only closed chats can be converted to a ticket',
      );
    }
    if (chat.converted_ticket_id) {
      // Idempotent: return the existing ticket reference.
      return { ticket_id: chat.converted_ticket_id, already_converted: true };
    }

    const description = await this.chatService.buildTicketDescription(id);
    const ticket = await this.supportService.createTicket(
      chat.user_id,
      chat.organization_id,
      {
        category: 'live_chat',
        priority: dto.priority ?? 'medium',
        subject: dto.subject ?? `[Live Chat] ${chat.topic}`.slice(0, 500),
        description,
      },
    );
    await this.chatService.markConvertedToTicket(id, ticket.id);
    return { ticket_id: ticket.id, already_converted: false };
  }

  // ─── #13 Canned Responses CRUD ──────────────────────────────
  @Get('canned-responses')
  async listCanned(@CurrentUser() user: any) {
    return this.cannedService.list(this.toActor(user));
  }

  @Post('canned-responses')
  async createCanned(
    @CurrentUser() user: any,
    @Body() dto: CreateCannedResponseDto,
  ) {
    return this.cannedService.create(this.toActor(user), dto);
  }

  @Patch('canned-responses/:id')
  async updateCanned(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCannedResponseDto,
  ) {
    return this.cannedService.update(id, this.toActor(user), dto);
  }

  @Delete('canned-responses/:id')
  async removeCanned(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.cannedService.remove(id, this.toActor(user));
    return { success: true };
  }

  // ─── #14 Availability ───────────────────────────────────────
  @Get('availability')
  async getAvailability(@CurrentUser() user: any) {
    return this.availabilityService.getMine(this.toActor(user));
  }

  @Put('availability')
  async setAvailability(
    @CurrentUser() user: any,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.availabilityService.setMine(
      this.toActor(user),
      dto.status as OpsAvailabilityStatus,
    );
  }
}
