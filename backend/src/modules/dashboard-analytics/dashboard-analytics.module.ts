import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Project,
  Contract,
  Clause,
  ContractClause,
  RiskAnalysis,
  Obligation,
  DocumentUpload,
} from '../../database/entities';
import { DashboardAnalyticsController } from './dashboard-analytics.controller';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      Contract,
      Clause,
      ContractClause,
      RiskAnalysis,
      Obligation,
      DocumentUpload,
    ]),
  ],
  controllers: [DashboardAnalyticsController],
  providers: [DashboardAnalyticsService],
})
export class DashboardAnalyticsModule {}
