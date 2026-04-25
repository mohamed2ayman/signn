import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProjectPartiesModule } from './modules/project-parties/project-parties.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ClausesModule } from './modules/clauses/clauses.module';
import { KnowledgeAssetsModule } from './modules/knowledge-assets/knowledge-assets.module';
import { RiskAnalysisModule } from './modules/risk-analysis/risk-analysis.module';
import { ObligationsModule } from './modules/obligations/obligations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { StorageModule } from './modules/storage/storage.module';
import { AiModule } from './modules/ai/ai.module';
import { DocumentProcessingModule } from './modules/document-processing/document-processing.module';
import { DashboardAnalyticsModule } from './modules/dashboard-analytics/dashboard-analytics.module';
import { ExportModule } from './modules/export/export.module';
import { SupportModule } from './modules/support/support.module';
import { ContractSharingModule } from './modules/contract-sharing/contract-sharing.module';
import { PermissionDefaultsModule } from './modules/permission-defaults/permission-defaults.module';
import { ChatModule } from './modules/chat/chat.module';
import { DocuSignModule } from './modules/docusign/docusign.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { ContractTemplatesModule } from './modules/contract-templates/contract-templates.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { NoticesModule } from './modules/notices/notices.module';
import { SubContractsModule } from './modules/subcontracts/subcontracts.module';
import { HealthModule } from './health/health.module';
import { AdminHealthModule } from './modules/admin-health/admin-health.module';
import { AdminAuditLogModule } from './modules/admin-audit-log/admin-audit-log.module';
import { OperationsReviewModule } from './modules/operations-review/operations-review.module';
import { AdminAnalyticsModule } from './modules/admin-analytics/admin-analytics.module';
import { AdminOrganizationsModule } from './modules/admin-organizations/admin-organizations.module';
import { AdminBillingModule } from './modules/admin-billing/admin-billing.module';
import { dataSourceOptions } from './config/data-source';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...dataSourceOptions,
        autoLoadEntities: true,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
      }),
    }),
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    ProjectPartiesModule,
    ContractsModule,
    ClausesModule,
    KnowledgeAssetsModule,
    RiskAnalysisModule,
    ObligationsModule,
    NotificationsModule,
    SubscriptionsModule,
    StorageModule,
    AiModule,
    DocumentProcessingModule,
    DashboardAnalyticsModule,
    ExportModule,
    SupportModule,
    ContractSharingModule,
    PermissionDefaultsModule,
    ChatModule,
    DocuSignModule,
    CollaborationModule,
    ContractTemplatesModule,
    ClaimsModule,
    NoticesModule,
    SubContractsModule,
    HealthModule,
    AdminHealthModule,
    AdminAuditLogModule,
    OperationsReviewModule,
    AdminAnalyticsModule,
    AdminOrganizationsModule,
    AdminBillingModule,
  ],
})
export class AppModule {}
