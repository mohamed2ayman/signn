import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Contract,
  ContractClause,
  Clause,
  RiskAnalysis,
  Obligation,
} from '../../database/entities';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractClause,
      Clause,
      RiskAnalysis,
      Obligation,
    ]),
  ],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
