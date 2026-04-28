import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SupportChat,
  SupportChatStatus,
  SupportChatMessage,
  SupportChatSenderRole,
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { SupportGateway } from './support.gateway';
import {
  SupportChatService,
  RequestActor,
} from './support-chat.service';
import { validateChatAttachment } from './chat-attachment.validator';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

@Injectable()
export class SupportChatMessageService {
  constructor(
    @InjectRepository(SupportChat)
    private readonly chatRepo: Repository<SupportChat>,
    @InjectRepository(SupportChatMessage)
    private readonly messageRepo: Repository<SupportChatMessage>,
    private readonly storage: StorageService,
    private readonly gateway: SupportGateway,
    private readonly chatService: SupportChatService,
  ) {}

  async sendMessage(
    chatId: string,
    actor: RequestActor,
    body: string | undefined,
    file: UploadedFile | undefined,
  ): Promise<SupportChatMessage> {
    const trimmed = (body ?? '').trim();
    if (!trimmed && !file) {
      throw new BadRequestException(
        'Message must include either text or an attachment',
      );
    }

    // Permission + status gate
    const chat = await this.chatService.getChatById(chatId, actor);
    if (
      chat.status === SupportChatStatus.CLOSED
    ) {
      throw new ConflictException('Cannot post to a closed chat');
    }
    if (chat.status === SupportChatStatus.WAITING && OPS_ROLES.has(actor.role)) {
      // An ops user replying to a WAITING chat implicitly claims nothing —
      // they should call /claim first. Reject to keep the queue UX honest.
      throw new ConflictException(
        'Claim the chat before sending a message',
      );
    }

    let attachment_url: string | null = null;
    let attachment_name: string | null = null;
    let attachment_mime: string | null = null;
    let attachment_size: number | null = null;

    if (file) {
      validateChatAttachment(file);
      const uploaded = await this.storage.uploadFile(file, 'support-chat');
      attachment_url = uploaded.file_url;
      attachment_name = uploaded.file_name;
      attachment_mime = uploaded.mime_type;
      attachment_size = uploaded.file_size;
    }

    const senderRole = OPS_ROLES.has(actor.role)
      ? SupportChatSenderRole.OPS
      : SupportChatSenderRole.USER;

    const message = this.messageRepo.create({
      chat_id: chatId,
      sender_id: actor.id,
      sender_role: senderRole,
      body: trimmed,
      attachment_url,
      attachment_name,
      attachment_mime,
      attachment_size,
    });
    const saved = await this.messageRepo.save(message);

    this.gateway.emitMessage(chatId, saved);
    return saved;
  }
}
