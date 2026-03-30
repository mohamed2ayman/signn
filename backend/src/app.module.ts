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
  ],
})
export class AppModule {}
