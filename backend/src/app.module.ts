import { Module, ClassSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { GuestPortalModule } from './modules/guest-portal/guest-portal.module';
import { MeteringModule } from './modules/metering/metering.module';
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
import { PortfolioAnalyticsModule } from './modules/portfolio-analytics/portfolio-analytics.module';
import { PortfolioExportModule } from './modules/portfolio-export/portfolio-export.module';
import { ExportModule } from './modules/export/export.module';
import { SupportModule } from './modules/support/support.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { ContractSharingModule } from './modules/contract-sharing/contract-sharing.module';
import { PermissionDefaultsModule } from './modules/permission-defaults/permission-defaults.module';
import { ChatModule } from './modules/chat/chat.module';
import { DocuSignModule } from './modules/docusign/docusign.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { ContractTemplatesModule } from './modules/contract-templates/contract-templates.module';
import { ContractRelationshipTypesModule } from './modules/contract-relationship-types/contract-relationship-types.module';
import { ContractPartiesModule } from './modules/contract-parties/contract-parties.module';
import { RedlineModule } from './modules/redlines/redline.module';
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
import { LegalDocumentsModule } from './modules/legal-documents/legal-documents.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
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
        // #8c Part 1 — pure-GUEST access-token TTL (read ONLY by
        // issueGuestSession). Guests cannot refresh (refreshToken rejects
        // GUEST account_type), so this is the FULL guest session length.
        // Managing users stay on JWT_ACCESS_EXPIRES_IN.
        JWT_GUEST_ACCESS_EXPIRES_IN: Joi.string().default('1h'),
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
        // 'smtp' (default, uses SMTP_HOST/PORT/USER/PASS) or 'ses' (AWS SES).
        EMAIL_DRIVER:     Joi.string().valid('smtp', 'ses').default('smtp'),
        SMTP_HOST:        Joi.string().optional().allow(''),
        SMTP_PORT:        Joi.number().optional(),
        SMTP_USER:        Joi.string().optional().allow(''),
        SMTP_PASS:        Joi.string().optional().allow(''),
        SENDGRID_API_KEY: Joi.string().optional().allow(''),
        FROM_EMAIL:       Joi.string().email().optional().default('noreply@sign.ai'),

        // ── File storage
        UPLOAD_DIR: Joi.string().optional().default('./uploads'),
        // 'local' (default, uses Docker named volume) or 's3' (AWS S3).
        // When 's3', AWS_S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY are required.
        STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),

        // ── Encryption at rest (Phase 7.28 prerequisite) ─────────
        // Master key for the AES-256-GCM CryptoService (common/utils/crypto.ts),
        // the first encryption-at-rest primitive in the codebase. First consumer
        // is ERP credential storage. OPTIONAL at boot (the app starts without it,
        // like the other optional integration vars); CryptoService throws a clear
        // error if encrypt/decrypt is called while it is missing. min(32) is the
        // defensive entropy floor — the key is SHA-256-derived to 32 bytes.
        ERP_CREDENTIAL_ENC_KEY: Joi.string().min(32).optional().allow(''),

        // ── ERP Integration (Phase 7.28) ──────────────────────────
        // Feature gate for the ERP integration module. OFF by default —
        // SIGN runs 100% without it. When false, every /erp/* and
        // /admin/erp/* route 404s (ErpEnabledGuard). The active per-org
        // connector is resolved at runtime from the connector REGISTRY
        // (erp_connections.vendor), NOT from any env var — there is
        // deliberately no active-adapter selector here.
        ERP_INTEGRATION_ENABLED: Joi.boolean().default(false),
        // Phase 7.28 v1.1 — circuit-breaker: auto-suspend a connection after
        // ERP_CIRCUIT_BREAKER_THRESHOLD consecutive sync/force-check failures,
        // when ERP_CIRCUIT_BREAKER_ENABLED is true. Per-connection overrides
        // are deferred to the entitlement task.
        ERP_CIRCUIT_BREAKER_ENABLED: Joi.boolean().default(true),
        ERP_CIRCUIT_BREAKER_THRESHOLD: Joi.number().integer().min(1).default(5),

        // ── Portfolio Export (Phase 7.17 Prompt 2c) ───────────────
        // HMAC secret for token-gated PDF download links. The bare-HTTP
        // download endpoint (GET /portfolio-exports/download) has NO JWT
        // layer behind it (Phase 7.17 Prompt 2c §3 #11 — no global guard,
        // opt-in only, and the download controller does not opt in).
        // This secret is the ENTIRE security floor for that endpoint.
        // min(32) is the strict floor — never lower.
        PORTFOLIO_EXPORT_DOWNLOAD_SECRET: Joi.string().min(32).required(),

        // ── Guest Portal (Phase 7.18 bucket 1b-i) ─────────────────
        // HMAC secret for the LONG-LIVED guest-invitation token (emailed).
        // The exchange endpoint (POST /public/guest-invitations/exchange)
        // has NO JWT layer behind it — this secret is the entire security
        // floor for that endpoint. min(32) is the strict floor.
        GUEST_INVITE_SECRET: Joi.string().min(32).required(),
        // HMAC secret for the SHORT-LIVED viewer credential issued at
        // exchange time. Carried as an Authorization: Viewer <token>
        // bearer on the recipient's contract reads — bound to ONE
        // contract_id, NO write capability. Distinct from GUEST_INVITE_SECRET
        // so a compromise of one does not bridge to the other.
        GUEST_VIEWER_SECRET: Joi.string().min(32).required(),
        // Invitation token lifetime (days) — ops-configurable per spec
        // decision 3. Default 30 days. min 1, max 365 (defensive bounds;
        // anything outside that range is almost certainly an error).
        GUEST_INVITE_TTL_DAYS: Joi.number().integer().min(1).max(365).default(30),
        // Viewer credential lifetime (minutes). Short by design — the
        // viewer is the pre-password read credential, not a session.
        // Default 15 minutes. min 1, max 240.
        GUEST_VIEWER_TTL_MINUTES: Joi.number().integer().min(1).max(240).default(15),

        // ── Seed passwords (only required when running seed scripts, not on app start)
        SEED_ADMIN_PASSWORD_1: Joi.string().min(12).optional(),
        SEED_ADMIN_PASSWORD_2: Joi.string().min(12).optional(),
        SEED_ADMIN_PASSWORD_3: Joi.string().min(12).optional(),
        // Optional opt-in: when set (min 12), seeds the owner@sign.com OWNER_ADMIN test user.
        SEED_OWNER_ADMIN_PASSWORD: Joi.string().min(12).optional(),

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
          // Phase 7.17 Prompt 2c D6 — abuse mitigation, NOT capacity limit.
          // Legitimate burst ceiling ≈ 3 (generate, change period,
          // regenerate, maybe change project filter); 5 leaves slack so a
          // flaky moment doesn't hit the limit on legitimate use.
          // Abuse vector: compromised OWNER_ADMIN exfiltration / queue DoS.
          { name: 'portfolio_export', ttl: 900_000, limit: 5  },
          // Phase 7.18 bucket 1b-i — abuse mitigation on the PUBLIC
          // invitation-token exchange (no JWT, signed-token-only auth).
          // Legitimate user redeems an invitation ≤ 1× per device per
          // landing; 10/15min lets a flaky network re-try while still
          // killing token-spray. The HMAC-before-DB ordering in
          // InvitationTokenService.verify is the primary defense; the
          // throttle is a secondary cap on the public surface.
          { name: 'guest_invite_exchange', ttl: 900_000, limit: 10 },
          // Feature #4 — guest upload of a new contract version. BURST
          // protection only (NOT the daily cap — that is 5/day-per-contract,
          // enforced in GuestUploadService via an advisory-lock count). An
          // upload is a heavier, AI-pipeline-triggering action than a token
          // exchange, so it is stricter than guest_invite_exchange: 5/15min/IP
          // (mirrors portfolio_export's abuse-mitigation shape).
          { name: 'guest_upload', ttl: 900_000, limit: 5 },
          // Guest chat Slice 1 — guest AI question send. BURST protection
          // only (NOT the daily cap — that is 20/day-per-contract, enforced
          // in GuestChatService via the atomic daily counter). Chat turns
          // are conversational, so the window is shorter and looser than
          // guest_upload: 10/min/IP.
          { name: 'guest_ai_query', ttl: 60_000, limit: 10 },
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
    GuestPortalModule,
    MeteringModule,
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
    PortfolioAnalyticsModule,
    PortfolioExportModule,
    ExportModule,
    SupportModule,
    SupportChatModule,
    ContractSharingModule,
    PermissionDefaultsModule,
    ChatModule,
    DocuSignModule,
    CollaborationModule,
    ContractTemplatesModule,
    // Multi-tier trunk T0a — relationship-type registry (GET /contract-relationship-types).
    ContractRelationshipTypesModule,
    // Multi-tier trunk T0c-1 — contract parties + party-role registry (GET /party-roles).
    ContractPartiesModule,
    // 7.19 Slice 1 — counterparty redlining spine (clause_redlines negotiation loop).
    RedlineModule,
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
    LegalDocumentsModule,
    IntegrationsModule,
  ],
  providers: [
    // Global response serializer. Triggers class-transformer `instanceToPlain`
    // on every controller response that is a class instance, applying entity-
    // level decorators like @Exclude() on User.{password_hash, mfa_secret,
    // mfa_totp_secret, mfa_recovery_codes, invitation_token}. Plain-object
    // responses (e.g. auth flows via sanitizeUser) pass through unchanged.
    // Composes with the global ValidationPipe + HttpExceptionFilter set in
    // main.ts — interceptors run after pipes and around route handlers.
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {}
