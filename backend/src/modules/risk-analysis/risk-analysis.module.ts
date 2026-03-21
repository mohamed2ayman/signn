import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RiskAnalysis, RiskRule, RiskCategory } from '../../database/entities';
import { RiskAnalysisController } from './risk-analysis.controller';
import { RiskAnalysisService } from './risk-analysis.service';

@Module({
  imports: [TypeOrmModule.forFeature([RiskAnalysis, RiskRule, RiskCategory])],
  controllers: [RiskAnalysisController],
  providers: [RiskAnalysisService],
  exports: [RiskAnalysisService],
})
export class RiskAnalysisModule {}
