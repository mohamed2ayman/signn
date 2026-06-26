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
  User,
} from '../../database/entities';
import { DocumentProcessingController } from './document-processing.controller';
import { DocumentProcessingService } from './document-processing.service';
import { ParseDocxController } from './parse-docx.controller';
import { ParseDocxService } from './parse-docx.service';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { RiskAnalysisModule } from '../risk-analysis/risk-analysis.module';
// Tenant-isolation Tier 1 — service-level wall on uploadAndProcess +
// reprocess + finalizeReview. ContractsModule exports ContractAccessService.
import { ContractsModule } from '../contracts/contracts.module';
// Phase 7.18 Part 3 — second consumer wiring (upload_extraction).
// MeteringModule exports MeteringService (the engine authority — call
// only; engine code MUST NOT be modified).
import { MeteringModule } from '../metering/metering.module';
// Option B — S2f: exports DocumentUploadScopedRepository — the data-layer
// tenancy chokepoint the two clean DocumentUpload reads load through, under
// the findInOrg wall (two checks, two layers).
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';

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
      // Guest extraction completion (Slice 1) — read the uploader's
      // account_type so the advance core decides proposed-vs-live intrinsically.
      User,
    ]),
    StorageModule,
    AiModule,
    // Phase 7.17 — Prompt 1, A.1: exports RiskMethodologyResolverService
    // which the AI risk writer injects to resolve default L/I per finding.
    RiskAnalysisModule,
    ContractsModule,
    MeteringModule,
    ScopedRepositoryModule,
  ],
  controllers: [DocumentProcessingController, ParseDocxController],
  providers: [DocumentProcessingService, ParseDocxService],
  exports: [DocumentProcessingService, ParseDocxService],
})
export class DocumentProcessingModule {}
