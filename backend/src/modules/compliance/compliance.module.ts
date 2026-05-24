import { Module } from '@nestjs/common';
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
  Obligation,
  ObligationAssignee,
  ObligationReminderLog,
  Organization,
  Project,
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
      Obligation,
      ObligationAssignee,
      ObligationReminderLog,
      Organization,
      Project,
      User,
    ]),
    BullModule.registerQueue({ name: 'compliance-jobs' }),
    AiModule,
    NotificationsModule,
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
  ],
  exports: [
    ComplianceService,
    ComplianceObligationService,
    ObligationTokenService,
    IcalExportService,
  ],
})
export class ComplianceModule {}
