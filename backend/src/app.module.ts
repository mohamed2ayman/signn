import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { getClientIp } from './common/utils/get-client-ip.util';
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
import { SupportChatModule } from './modules/support-chat/support-chat.module';
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
import { NegotiationModule } from './modules/negotiation/negotiation.module';
import { AdminSecurityModule } from './modules/admin-security/admin-security.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { TokenBlacklistModule } from './common/services/token-blacklist.module';
import { dataSourceOptions } from './config/data-source';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({

        // ── Core App ─────────────────────────────────────────────
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3000),

        // ── Database ─────────────────────────────────────────────
        DATABASE_URL: Joi.string().required(),

        // ── Auth ─────────────────────────────────────────────────
        JWT_SECRET: Joi.string().min(16).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        JWT_EXPIRES_IN: Joi.string().default('7d'),
        NESTJS_INTERNAL_TOKEN: Joi.string().required(),

        // ── Redis ─────────────────────────────────────────────────
        REDIS_URL: Joi.string().required(),

        // ── Frontend ──────────────────────────────────────────────
        FRONTEND_URL: Joi.string().uri().required(),
        BASE_URL:     Joi.string().uri().required(),

        // ── AI Backend ───────────────────────────────────────────
        AI_BACKEND_URL: Joi.string()
          .uri()
          .default('http://ai-backend:8000'),

        // ── Anthropic AI (optional — AI features degrade gracefully)
        ANTHROPIC_API_KEY: Joi.string().optional().allow(''),

        // ── DocuSign (optional — blocked feature, no sandbox yet)
        DOCUSIGN_INTEGRATION_KEY:     Joi.string().optional().allow(''),
        DOCUSIGN_SECRET_KEY:          Joi.string().optional().allow(''),
        DOCUSIGN_ACCOUNT_ID:          Joi.string().optional().allow(''),
        DOCUSIGN_WEBHOOK_HMAC_SECRET: Joi.string().optional().allow(''),
        // DocuSign JWT Grant (optional — only needed when DocuSign is configured)
        DOCUSIGN_RSA_PRIVATE_KEY:     Joi.string().optional().allow(''),
        DOCUSIGN_AUTH_SERVER:         Joi.string().uri().optional().allow('')
          .default('https://account-d.docusign.com'),
        DOCUSIGN_BASE_PATH:           Joi.string().uri().optional().allow('')
          .default('https://demo.docusign.net/restapi'),
        DOCUSIGN_USER_ID:             Joi.string().optional().allow(''),

        // ── Paymob (optional — blocked feature, no test keys yet)
        PAYMOB_API_KEY:        Joi.string().optional().allow(''),
        PAYMOB_INTEGRATION_ID: Joi.string().optional().allow(''),
        PAYMOB_IFRAME_ID:      Joi.string().optional().allow(''),
        PAYMOB_HMAC_SECRET:    Joi.string().optional().allow(''),

        // ── AWS / S3 (optional — not configured yet)
        AWS_ACCESS_KEY_ID:     Joi.string().optional().allow(''),
        AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
        AWS_REGION:            Joi.string().default('us-east-1'),
        AWS_S3_BUCKET:         Joi.string().optional().allow(''),

        // ── Email / SMTP (optional — not configured yet)
        SMTP_HOST:        Joi.string().optional().allow(''),
        SMTP_PORT:        Joi.number().optional(),
        SMTP_USER:        Joi.string().optional().allow(''),
        SMTP_PASS:        Joi.string().optional().allow(''),
        SENDGRID_API_KEY: Joi.string().optional().allow(''),
        FROM_EMAIL:       Joi.string().email().optional().default('noreply@sign.ai'),

        // ── File storage
        UPLOAD_DIR: Joi.string().optional().default('./uploads'),

        // ── Seed passwords (only required when running seed scripts, not on app start)
        SEED_ADMIN_PASSWORD_1: Joi.string().min(12).optional(),
        SEED_ADMIN_PASSWORD_2: Joi.string().min(12).optional(),
        SEED_ADMIN_PASSWORD_3: Joi.string().min(12).optional(),

      }),
      validationOptions: {
        allowUnknown: true,   // allow extra vars not in schema
        abortEarly: false,    // report ALL missing vars at once
      },
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
    // ─── Rate Limiting ────────────────────────────────────────────────
    // Storage is Redis-backed (same REDIS_URL as Bull). Thresholds and
    // policy live in CLAUDE.md → "Rate Limiting Policy". ThrottlerGuard
    // is applied per-controller (auth), NOT globally — only auth flows
    // need brute-force protection at the network layer.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Key requests by real client IP (works with `trust proxy = 1`
        // in main.ts). All throttlers share this tracker. The cast is
        // safe — throttler hands us the underlying Express Request.
        getTracker: (req: Record<string, unknown>) =>
          getClientIp(req as unknown as import('express').Request),
        storage: new ThrottlerStorageRedisService(
          configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
        ),
        throttlers: [
          { name: 'login',      ttl: 600_000,    limit: 5  },
          { name: 'register',   ttl: 3_600_000,  limit: 3  },
          { name: 'forgot',     ttl: 3_600_000,  limit: 3  },
          { name: 'reset',      ttl: 900_000,    limit: 5  },
          { name: 'mfa',        ttl: 600_000,    limit: 5  },
          { name: 'recovery',   ttl: 3_600_000,  limit: 3  },
          { name: 'refresh',    ttl: 900_000,    limit: 20 },
          { name: 'invitation', ttl: 3_600_000,  limit: 5  },
          { name: 'waitlist',   ttl: 3_600_000,  limit: 3  },
        ],
      }),
    }),
    TokenBlacklistModule,
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
    SupportChatModule,
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
    NegotiationModule,
    AdminSecurityModule,
    ComplianceModule,
    WaitlistModule,
  ],
})
export class AppModule {}
