import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('sessions')
  async createSession(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.chatService.createSession(user.id, orgId, dto.contract_id);
  }

  @Get('sessions/by-contract')
  async findByContract(
    @Query('contract_id') contractId: string,
    @CurrentUser() user: any,
  ) {
    const session = await this.chatService.findSessionByContract(
      user.id,
      contractId,
    );
    return session || null;
  }

  @Get('sessions/:id/messages')
  async getMessages(
    @Param('id') sessionId: string,
    @CurrentUser() user: any,
  ) {
    return this.chatService.getSessionMessages(sessionId, user.id);
  }

  @Post('sessions/:id/messages')
  async sendMessage(
    @Param('id') sessionId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.chatService.sendMessage(
      sessionId,
      user.id,
      orgId,
      dto.message,
    );
  }
}
