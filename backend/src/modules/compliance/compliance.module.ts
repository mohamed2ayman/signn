import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import {
  ComplianceCheck,
  ComplianceFinding,
  ComplianceReportJob,
  Contract,
  ContractClause,
  KnowledgeAsset,
  KnowledgeAssetUsage,
  Obligation,
  ObligationAssignee,
  ObligationReminderLog,
  Organization,
  PermissionDefault,
  Project,
  ProjectMember,
  User,
} from '../../database/entities';
import { ComplianceController, ComplianceReportDownloadController } from './controllers/compliance.controller';
import { ComplianceObligationsController } from './controllers/compliance-obligations.controller';
import { PublicObligationController } from './controllers/public-obligation.controller';
import { ComplianceService } from './services/compliance.service';
import { ComplianceFindingService } from './services/compliance-finding.service';
import { ComplianceObligationService } from './services/compliance-obligation.service';
import { ComplianceKnowledgeService } from './services/compliance-knowledge.service';
import { ComplianceReportService } from './services/compliance-report.service';
import { PdfReportService } from './services/pdf-report.service';
import { ObligationTokenService } from './services/obligation-token.service';
import { IcalExportService } from './services/ical-export.service';
import { ComplianceReportProcessor } from './processors/compliance-report.processor';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractsModule } from '../contracts/contracts.module';
import { MeteringModule } from '../metering/metering.module';
// Option B — S2c-1: ObligationScopedRepository for the ical list read
// (data-layer tenancy chokepoint under the #60 wall).
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ResolveObligationProjectMiddleware } from '../../common/middleware/resolve-obligation-project.middleware';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    TypeOrmModule.forFeature([
      ComplianceCheck,
      ComplianceFinding,
      ComplianceReportJob,
      Contract,
      ContractClause,
      KnowledgeAsset,
      // Phase 7.24b: write backlink rows when a compliance check consumes assets.
      KnowledgeAssetUsage,
      Obligation,
      ObligationAssignee,
      ObligationReminderLog,
      Organization,
      PermissionDefault,
      Project,
      ProjectMember,
      User,
    ]),
    BullModule.registerQueue({ name: 'compliance-jobs' }),
    AiModule,
    NotificationsModule,
    // Bring in ContractAccessService for the cross-tenant access wall on
    // every compliance endpoint (this fix — PR #42 class). ContractsModule
    // exports it; we don't depend on anything else from there.
    ContractsModule,
    // Phase 7.18 Part 2 — first consumer wiring. MeteringModule exports
    // MeteringService (the engine authority). The compliance run is the
    // first surface to call reserve / commit / release.
    MeteringModule,
    // Option B — S2c-1: scoped obligation loads (ical read; more in S2c-2).
    ScopedRepositoryModule,
  ],
  controllers: [
    ComplianceController,
    ComplianceReportDownloadController,
    ComplianceObligationsController,
    PublicObligationController,
  ],
  providers: [
    ComplianceService,
    ComplianceFindingService,
    ComplianceObligationService,
    ComplianceKnowledgeService,
    ComplianceReportService,
    PdfReportService,
    ObligationTokenService,
    IcalExportService,
    ComplianceReportProcessor,
    PermissionLevelGuard,
    ResolveObligationProjectMiddleware,
  ],
  exports: [
    ComplianceService,
    ComplianceObligationService,
    ObligationTokenService,
    IcalExportService,
  ],
})
export class ComplianceModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ResolveObligationProjectMiddleware)
      .forRoutes('contracts', 'projects', 'obligations');
  }
}
