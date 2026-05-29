import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  KnowledgeAsset,
  RiskAnalysis,
  RiskAnalysisOverrideLog,
  RiskCategory,
  RiskCategoryOrgLearnedBaseline,
  RiskCategoryPlatformDefault,
  RiskRule,
} from '../../database/entities';
import { KnowledgeAssetsModule } from '../knowledge-assets/knowledge-assets.module';
import { RiskDriftController } from './controllers/risk-drift.controller';
import { LearnedBaselineProcessor } from './learned-baseline.processor';
import { RiskAnalysisController } from './risk-analysis.controller';
import { RiskAnalysisService } from './risk-analysis.service';
import { DriftReportService } from './services/drift-report.service';
import { RiskExplanationService } from './services/risk-explanation.service';
import { RiskMethodologyResolverService } from './services/risk-methodology-resolver.service';
import { RiskOverrideService } from './services/risk-override.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskAnalysis,
      RiskRule,
      RiskCategory,
      // Phase 7.17 — Prompt 1, B.1: resolver queries KnowledgeAsset for
      // user-flagged risk methodology references (step 1 of the chain).
      KnowledgeAsset,
      // Phase 7.17 — Prompt 1, S.2: platform defaults backing step 3.
      RiskCategoryPlatformDefault,
      // Phase 7.17 — Prompt 1, S.3: learned baselines backing step 2.
      RiskCategoryOrgLearnedBaseline,
      // Phase 7.17 — Prompt 1, S.4: append-only override audit log,
      // injected by B.3 override service.
      RiskAnalysisOverrideLog,
    ]),
    // Phase 7.17 — Prompt 1, B.2: KnowledgeAssetsModule exports
    // RiskMethodologyReaderService, which the resolver injects to
    // parse the user-flagged KB methodology block in step 1.
    KnowledgeAssetsModule,
    // Phase 7.17 — Prompt 1, B.3 → B.4 touchpoint. Queue declared here
    // so the override service can enqueue recompute jobs after every
    // override commits. The consuming worker (B.4) is a separate phase;
    // until then, jobs accumulate in Redis (Bull's "pending work"
    // behaviour). Same convention as obligations module's
    // 'obligation-reminders' queue and notifications module's
    // 'email-queue'.
    BullModule.registerQueue({ name: 'learned-baseline' }),
  ],
  controllers: [
    RiskAnalysisController,
    // Phase 7.17 — Prompt 1, B.5: org-wide drift report, OWNER_ADMIN only.
    RiskDriftController,
  ],
  providers: [
    RiskAnalysisService,
    // Phase 7.17 — Prompt 1, B.1: resolves L/I defaults for new findings
    // via the 4-step priority chain (KB ref → org learned → platform default
    // → fallback). Exported so B.3 (override service) can inject it.
    RiskMethodologyResolverService,
    // Phase 7.17 — Prompt 1, B.3: applies user overrides to risk findings
    // (OWNER_ADMIN gated at the controller). Exported so B.5's explanation
    // endpoint can read the override history through this service too.
    RiskOverrideService,
    // Phase 7.17 — Prompt 1, B.4: consumes the 'learned-baseline' queue
    // B.3 registered. Recomputes the per-(org,category) median L,I from
    // the last 50 overrides and upserts into
    // risk_category_org_learned_baselines. Not exported — only Bull
    // injects it, via the @Processor decorator.
    LearnedBaselineProcessor,
    // Phase 7.17 — Prompt 1, B.5: read-side provenance for the F.1
    // explanation popover. Injected by RiskAnalysisController.
    RiskExplanationService,
    // Phase 7.17 — Prompt 1, B.5: org-wide drift aggregation backing
    // RiskDriftController. Injected by RiskOverrideService (B.3
    // touchpoint) to invalidate the per-org cache on each override.
    DriftReportService,
  ],
  exports: [
    RiskAnalysisService,
    RiskMethodologyResolverService,
    RiskOverrideService,
  ],
})
export class RiskAnalysisModule {}
