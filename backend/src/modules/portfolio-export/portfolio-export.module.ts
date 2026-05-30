import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PortfolioExportJob } from './entities/portfolio-export-job.entity';
import { PortfolioExportTokenService } from './services/portfolio-export-token.service';
import { PortfolioExportRendererService } from './services/portfolio-export-renderer.service';
import { PortfolioExportService } from './services/portfolio-export.service';
import { PortfolioExportProcessor } from './processors/portfolio-export.processor';
import { PortfolioAnalyticsModule } from '../portfolio-analytics/portfolio-analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Phase 7.17 Prompt 2c — portfolio export module.
 *
 * Bucket 2 wires:
 *   - Token service (built in Bucket 1)
 *   - Renderer service (new)
 *   - Façade service for enqueueing (new)
 *   - Processor for the 'portfolio-export-jobs' queue (new)
 *
 * Bucket 3 will add the HTTP controllers (POST request + GET download)
 * and the cleanup cron — both will live in this same module.
 *
 * Module imports:
 *   - PortfolioAnalyticsModule — re-exports PortfolioAnalyticsService
 *     so the processor can call the same 9 aggregations the live
 *     dashboard uses. Verified callable from a BullMQ processor at
 *     plan review §3 #5 (no REQUEST scope, parameter-driven).
 *   - NotificationsModule — exports EmailService; the processor uses
 *     `sendGenericEmail()` directly + await for fail-closed semantics
 *     (divergence from compliance's fire-and-forget — see processor
 *     comment + Bucket 2 commit message).
 *
 * StorageModule and ConfigModule are @Global() / global-ish; no
 * explicit import needed.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PortfolioExportJob]),
    BullModule.registerQueue({ name: 'portfolio-export-jobs' }),
    PortfolioAnalyticsModule,
    NotificationsModule,
  ],
  providers: [
    PortfolioExportTokenService,
    PortfolioExportRendererService,
    PortfolioExportService,
    PortfolioExportProcessor,
  ],
  exports: [
    PortfolioExportService,
    PortfolioExportTokenService,
  ],
})
export class PortfolioExportModule {}
