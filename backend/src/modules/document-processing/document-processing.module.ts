import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuditLog,
  DocumentUpload,
  Clause,
  ContractClause,
  Contract,
  RiskAnalysis,
  RiskCategory,
} from '../../database/entities';
import { DocumentProcessingController } from './document-processing.controller';
import { DocumentProcessingService } from './document-processing.service';
import { ParseDocxController } from './parse-docx.controller';
import { ParseDocxService } from './parse-docx.service';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { RiskAnalysisModule } from '../risk-analysis/risk-analysis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentUpload,
      Clause,
      ContractClause,
      Contract,
      RiskAnalysis,
      // Phase 7.17 — Prompt 1, A.1: AI risk writer audit-logs
      // unrecognized-category events (AI_RETURNED_UNKNOWN_RISK_CATEGORY).
      AuditLog,
      // Phase 7.17 — Prompt 1, A.1: AI risk writer validates returned
      // risk_category against the active taxonomy. Unknown → falls back
      // to 'Uncategorized' + audit log.
      RiskCategory,
    ]),
    StorageModule,
    AiModule,
    // Phase 7.17 — Prompt 1, A.1: exports RiskMethodologyResolverService
    // which the AI risk writer injects to resolve default L/I per finding.
    RiskAnalysisModule,
  ],
  controllers: [DocumentProcessingController, ParseDocxController],
  providers: [DocumentProcessingService, ParseDocxService],
  exports: [DocumentProcessingService, ParseDocxService],
})
export class DocumentProcessingModule {}
