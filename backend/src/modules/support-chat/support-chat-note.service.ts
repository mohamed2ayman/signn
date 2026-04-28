import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportChatNote } from '../../database/entities';
import { SupportGateway } from './support.gateway';
import {
  SupportChatService,
  RequestActor,
} from './support-chat.service';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

@Injectable()
export class SupportChatNoteService {
  constructor(
    @InjectRepository(SupportChatNote)
    private readonly noteRepo: Repository<SupportChatNote>,
    private readonly chatService: SupportChatService,
    private readonly gateway: SupportGateway,
  ) {}

  async addNote(
    chatId: string,
    actor: RequestActor,
    body: string,
  ): Promise<SupportChatNote> {
    if (!OPS_ROLES.has(actor.role)) {
      throw new ForbiddenException('Operations role required');
    }
    const chat = await this.chatService.getChatById(chatId, actor);

    const note = this.noteRepo.create({
      chat_id: chatId,
      ops_id: actor.id,
      body,
    });
    const saved = await this.noteRepo.save(note);

    // Critical: emit ONLY to the ops queue room, never to the chat room.
    this.gateway.emitNoteAdded(chat.organization_id, {
      chatId,
      note: saved,
    });
    return saved;
  }

  async listNotes(
    chatId: string,
    actor: RequestActor,
  ): Promise<SupportChatNote[]> {
    if (!OPS_ROLES.has(actor.role)) {
      throw new ForbiddenException('Operations role required');
    }
    // assertCanAccessChat guards org isolation
    await this.chatService.getChatById(chatId, actor);

    return this.noteRepo.find({
      where: { chat_id: chatId },
      order: { created_at: 'ASC' },
      relations: ['ops'],
    });
  }
}
