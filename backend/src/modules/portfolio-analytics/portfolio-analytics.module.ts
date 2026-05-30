import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract, RiskAnalysis } from '../../database/entities';
import { PortfolioAnalyticsController } from './portfolio-analytics.controller';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([Contract, RiskAnalysis])],
  controllers: [PortfolioAnalyticsController],
  providers: [PortfolioAnalyticsService],
  // Exported so PortfolioExportModule's processor can call the same 9
  // aggregations the live dashboard uses (Phase 7.17 Prompt 2c Bucket 2).
  // Plan review §3 #5 confirmed the service is safely callable from a
  // BullMQ processor: singleton scope, parameter-driven, no @Req anywhere.
  exports: [PortfolioAnalyticsService],
})
export class PortfolioAnalyticsModule {}
