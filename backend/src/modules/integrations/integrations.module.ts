import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { CryptoModule } from '../../common/crypto/crypto.module';
import { User } from '../../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminSecurityModule } from '../admin-security/admin-security.module';
import { ErpConnection } from './entities/erp-connection.entity';
import { ErpFieldMapping } from './entities/erp-field-mapping.entity';
import { ErpSyncJob } from './entities/erp-sync-job.entity';
import { ErpCostRecord } from './entities/erp-cost-record.entity';
import {
  ERP_CONNECTOR_REGISTRY,
  ERP_CONNECTORS,
} from './connectors/erp-connector.interface';
import { ErpConnectorRegistry } from './connectors/connector-registry';
import { MockErpConnector } from './connectors/mock-erp.connector';
import { SapCostConnector } from './connectors/sap-cost.connector';
import { ErpConnectionService } from './services/erp-connection.service';
import { ErpSyncService } from './services/erp-sync.service';
import { ErpAdminService } from './services/erp-admin.service';
import { ErpSyncProcessor } from './processors/erp-sync.processor';
import { ErpEnabledGuard } from './guards/erp-enabled.guard';
import { ErpConnectionsController } from './controllers/erp-connections.controller';
import { AdminErpController } from './controllers/admin-erp.controller';

/**
 * Phase 7.28 — ERP integration (Part 1: backend + endpoints).
 *
 * NOT @Global() — this is a domain module (lesson #113 rule 3). The connector
 * registry resolves the active adapter PER-ORG at job time from
 * `erp_connections.vendor`; the env var only feature-GATES the module, it never
 * selects the active adapter.
 *
 * Adding a future ERP = (1) write the adapter file implementing IErpConnector,
 * (2) add it to the providers list AND the ERP_CONNECTORS factory below. The
 * registry, engine, queue, neutral model, and dashboard are untouched.
 *
 * CryptoService (PR #73) is provided here as its first consumer — credentials
 * are encrypted at rest on write and decrypted only in the worker.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ErpConnection,
      ErpFieldMapping,
      ErpSyncJob,
      ErpCostRecord,
      User, // Phase 7.28 v1.1 — OWNER_ADMIN lookup for suspension notifications
    ]),
    BullModule.registerQueue({ name: 'erp-sync-jobs' }),
    NotificationsModule, // exports NotificationDispatchService
    AdminSecurityModule, // exports SecurityEventService (immutable audit)
    CryptoModule, // exports CryptoService (encrypt ERP credentials at rest)
  ],
  controllers: [ErpConnectionsController, AdminErpController],
  providers: [
    // ── Adapters (each is one file; add a new one here + in the factory) ──
    MockErpConnector,
    SapCostConnector,
    {
      provide: ERP_CONNECTORS,
      useFactory: (mock: MockErpConnector, sap: SapCostConnector) => [mock, sap],
      inject: [MockErpConnector, SapCostConnector],
    },
    { provide: ERP_CONNECTOR_REGISTRY, useClass: ErpConnectorRegistry },
    // ── Core engine + façade ──
    ErpConnectionService,
    ErpSyncService,
    ErpAdminService,
    ErpSyncProcessor,
    ErpEnabledGuard,
  ],
  exports: [ErpConnectionService, ErpSyncService, ErpAdminService, ERP_CONNECTOR_REGISTRY],
})
export class IntegrationsModule {}
