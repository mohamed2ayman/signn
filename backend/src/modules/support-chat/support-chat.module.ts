import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SupportChat,
  SupportChatMessage,
  SupportChatNote,
  CannedResponse,
  OpsAvailability,
  User,
  AuditLog,
} from '../../database/entities';
import { StorageModule } from '../storage/storage.module';
import { SupportModule } from '../support/support.module';
import { SupportGateway } from './support.gateway';
import { SupportChatService } from './support-chat.service';
import { SupportChatMessageService } from './support-chat-message.service';
import { SupportChatNoteService } from './support-chat-note.service';
import { CannedResponseService } from './canned-response.service';
import { OpsAvailabilityService } from './ops-availability.service';
import { SupportChatController } from './support-chat.controller';
import { SupportChatOpsController } from './support-chat-ops.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportChat,
      SupportChatMessage,
      SupportChatNote,
      CannedResponse,
      OpsAvailability,
      User,
      AuditLog,
    ]),
    StorageModule,
    SupportModule,
  ],
  controllers: [SupportChatController, SupportChatOpsController],
  providers: [
    SupportGateway,
    SupportChatService,
    SupportChatMessageService,
    SupportChatNoteService,
    CannedResponseService,
    OpsAvailabilityService,
  ],
  exports: [SupportChatService],
})
export class SupportChatModule {}
