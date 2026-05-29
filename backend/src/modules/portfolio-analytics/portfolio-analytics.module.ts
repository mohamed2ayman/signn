import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project, Contract, RiskAnalysis } from '../../database/entities';
import { PortfolioAnalyticsController } from './portfolio-analytics.controller';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Contract, RiskAnalysis])],
  controllers: [PortfolioAnalyticsController],
  providers: [PortfolioAnalyticsService],
})
export class PortfolioAnalyticsModule {}
