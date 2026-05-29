import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, KnowledgeAsset, RiskCategory } from '../../database/entities';
import { KnowledgeAssetsController } from './knowledge-assets.controller';
import { KnowledgeAssetsService } from './knowledge-assets.service';
import { RiskMethodologyReaderService } from './services/risk-methodology-reader.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeAsset,
      // Phase 7.17 — Prompt 1, B.2: reader looks up risk categories
      // (active filter) for category-name validation in step 7 of its
      // validation chain.
      RiskCategory,
      // Phase 7.17 — Prompt 1, B.2: reader writes
      // KB_RISK_REFERENCE_MALFORMED audit entries on validation failure.
      AuditLog,
    ]),
    StorageModule,
  ],
  controllers: [KnowledgeAssetsController],
  providers: [
    KnowledgeAssetsService,
    // Phase 7.17 — Prompt 1, B.2: exported so RiskAnalysisModule (which
    // imports this module) can inject the reader into the resolver.
    RiskMethodologyReaderService,
  ],
  exports: [KnowledgeAssetsService, RiskMethodologyReaderService],
})
export class KnowledgeAssetsModule {}
