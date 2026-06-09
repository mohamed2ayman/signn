import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSession, ChatMessage, Contract } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
// Tenant-isolation Tier 1 — controller-level wall on dto.contract_id at
// the createSession entry point so a cross-tenant contract_id never gets
// stored on a ChatSession (the upstream gap that sendMessage inherits).
import { ContractsModule } from '../contracts/contracts.module';
// Phase E — legal-corpus retrieval grounding for chat answers.
import { LegalDocumentsModule } from '../legal-documents/legal-documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage, Contract]),
    AiModule,
    ContractsModule,
    LegalDocumentsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
