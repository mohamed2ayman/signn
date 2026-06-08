import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LegalDocument,
  LegalDocumentChunk,
  LegalSource,
} from '../../database/entities';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { LegalDocumentsService } from './legal-documents.service';
import { LegalDocumentsController } from './legal-documents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LegalDocument, LegalDocumentChunk, LegalSource]),
    StorageModule,
    AiModule,
  ],
  providers: [LegalDocumentsService],
  controllers: [LegalDocumentsController],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
