import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ContractAccessService } from '../contracts/services/contract-access.service';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    // Tenant-isolation Tier 1 — wall on dto.contract_id at session create.
    // sendMessage inherits the session's contract_id, so closing the
    // upstream entry point is sufficient (a session can never reach the
    // store carrying a cross-tenant contract_id).
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Managing-user access wall — same shape as ai.controller.ts.
   * Throws NotFoundException (404, NOT 403) on cross-tenant probe.
   */
  private async assertContractInCallerOrg(
    contractId: string,
    orgId: string | null | undefined,
  ): Promise<void> {
    if (!orgId) {
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);
  }

  @Post('sessions')
  async createSession(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    // contract_id is OPTIONAL — only gate when provided. An unscoped
    // chat session (no contract context) is allowed.
    if (dto.contract_id) {
      await this.assertContractInCallerOrg(dto.contract_id, orgId);
    }
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
    // sendMessage is downstream of createSession — a session can only
    // carry a contract_id that already passed the createSession wall.
    // Tenant isolation here is inherited; no additional check needed.
    // ASYNC (Phase 7.27): returns immediately with a PENDING assistant
    // message; the client polls GET /chat/messages/:id/status below.
    return this.chatService.sendMessage(
      sessionId,
      user.id,
      orgId,
      dto.message,
    );
  }

  /**
   * Async-chat advancer (Phase 7.27). The client polls this for the assistant
   * message until status is COMPLETED or FAILED. Ownership is enforced
   * service-side (caller must own the message's session).
   */
  @Get('messages/:id/status')
  async getMessageStatus(
    @Param('id') messageId: string,
    @CurrentUser() user: any,
  ) {
    return this.chatService.getMessageStatus(messageId, user.id);
  }
}
