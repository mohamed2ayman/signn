import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSession, ChatMessage } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
// Tenant-isolation Tier 1 — controller-level wall on dto.contract_id at
// the createSession entry point so a cross-tenant contract_id never gets
// stored on a ChatSession (the upstream gap that sendMessage inherits).
import { ContractsModule } from '../contracts/contracts.module';
// Phase E — legal-corpus retrieval grounding for chat answers.
import { LegalDocumentsModule } from '../legal-documents/legal-documents.module';
// Option B chokepoint (compliance finale) — provides ContractScopedRepository
// for buildLegalContext's now-un-deferred parent-Contract+project load. (The
// bare @InjectRepository(Contract) it replaced is gone, so Contract no longer
// needs forFeature registration here.)
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage]),
    AiModule,
    ContractsModule,
    LegalDocumentsModule,
    ScopedRepositoryModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
