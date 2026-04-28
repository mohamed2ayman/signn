import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupportChatService, RequestActor } from './support-chat.service';
import { SupportChatMessageService } from './support-chat-message.service';
import { StartChatDto, SendChatMessageDto, CsatDto } from './dto';
import type { UploadedFile as MulterFile } from '../storage/storage.service';

/**
 * User-facing Live Chat endpoints.
 * Mounted at /api/v1/support/chat — the global prefix is configured in main.ts.
 */
@Controller('support/chat')
@UseGuards(JwtAuthGuard)
export class SupportChatController {
  constructor(
    private readonly chatService: SupportChatService,
    private readonly messageService: SupportChatMessageService,
  ) {}

  private toActor(user: any): RequestActor {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id ?? null,
    };
  }

  /** #1 POST /support/chat — start a chat */
  @Post()
  async startChat(@CurrentUser() user: any, @Body() dto: StartChatDto) {
    return this.chatService.startChat(this.toActor(user), dto.topic);
  }

  /** #2 GET /support/chat/me — list own chats */
  @Get('me')
  async myChats(@CurrentUser() user: any) {
    return this.chatService.getMyChats(user.id);
  }

  /** #3 GET /support/chat/:id — get chat + messages */
  @Get(':id')
  async getChat(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getChatWithMessages(id, this.toActor(user));
  }

  /** #4 POST /support/chat/:id/message — send message + optional attachment */
  @Post(':id/message')
  @UseInterceptors(FileInterceptor('attachment'))
  async sendMessage(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendChatMessageDto,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.messageService.sendMessage(
      id,
      this.toActor(user),
      dto.body,
      file,
    );
  }

  /** #5 POST /support/chat/:id/csat — submit CSAT */
  @Post(':id/csat')
  async submitCsat(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CsatDto,
  ) {
    return this.chatService.submitCsat(
      id,
      dto.rating,
      dto.comment,
      this.toActor(user),
    );
  }
}
