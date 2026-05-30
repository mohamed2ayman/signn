import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PortfolioExportJob } from './entities/portfolio-export-job.entity';
import { PortfolioExportTokenService } from './services/portfolio-export-token.service';
import { PortfolioExportRendererService } from './services/portfolio-export-renderer.service';
import { PortfolioExportService } from './services/portfolio-export.service';
import { PortfolioExportProcessor } from './processors/portfolio-export.processor';
import { PortfolioExportCleanupProcessor } from './processors/portfolio-export-cleanup.processor';
import { PortfolioExportCleanupScheduler } from './schedulers/portfolio-export-cleanup.scheduler';
import { PortfolioExportController } from './controllers/portfolio-export.controller';
import { PortfolioExportDownloadController } from './controllers/portfolio-export-download.controller';
import { PortfolioAnalyticsModule } from '../portfolio-analytics/portfolio-analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminSecurityModule } from '../admin-security/admin-security.module';

/**
 * Phase 7.17 Prompt 2c — portfolio export module.
 *
 * Bucket 1 — token primitives + DB schema.
 * Bucket 2 — async pipeline (queue, renderer, processor, emails).
 * Bucket 3 — HTTP controllers (POST request + GET download with
 *            bare-HTTP + token-only auth per §3 #11), cleanup
 *            scheduler + cleanup processor (every 30 min, partial-index-
 *            matching query per Bucket 1 carry-forward), audit logging
 *            on every download outcome via SecurityEventService.
 *
 * Module imports:
 *   - PortfolioAnalyticsModule — re-exports PortfolioAnalyticsService
 *     so the render processor can call the same 9 aggregations the live
 *     dashboard uses. Verified callable from a BullMQ processor at
 *     plan review §3 #5 (no REQUEST scope, parameter-driven).
 *   - NotificationsModule — exports EmailService; the render processor
 *     uses sendGenericEmail() directly + await for fail-closed semantics
 *     (divergence from compliance's fire-and-forget — see processor
 *     comment + Bucket 2 commit message).
 *   - AdminSecurityModule — exports SecurityEventService; the download
 *     controller writes an audit row on every outcome (success +
 *     all 4 failure reasons) so leaked-URL probes are visible in
 *     admin/security forensics.
 *
 * StorageModule and ConfigModule are @Global() / global-ish — no
 * explicit import needed.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PortfolioExportJob]),
    BullModule.registerQueue({ name: 'portfolio-export-jobs' }),
    PortfolioAnalyticsModule,
    NotificationsModule,
    AdminSecurityModule,
  ],
  controllers: [
    PortfolioExportController,
    PortfolioExportDownloadController,
  ],
  providers: [
    PortfolioExportTokenService,
    PortfolioExportRendererService,
    PortfolioExportService,
    PortfolioExportProcessor,
    PortfolioExportCleanupProcessor,
    PortfolioExportCleanupScheduler,
  ],
  exports: [
    PortfolioExportService,
    PortfolioExportTokenService,
  ],
})
export class PortfolioExportModule {}
