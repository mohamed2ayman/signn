import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { CryptoService } from '../../../common/utils/crypto';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { ErpConnection, ErpOperatorHoldState } from '../entities/erp-connection.entity';
import { ErpFieldMapping } from '../entities/erp-field-mapping.entity';
import { ErpSyncJob } from '../entities/erp-sync-job.entity';
import { ErpCostRecord } from '../entities/erp-cost-record.entity';
import { User } from '../../../database/entities';
import { ErpConnectorRegistry } from '../connectors/connector-registry';
import { MockErpConnector } from '../connectors/mock-erp.connector';
import { SapCostConnector } from '../connectors/sap-cost.connector';
import {
  ERP_CONNECTOR_REGISTRY,
  ERP_CONNECTORS,
  ErpSyncDirection,
  ErpSyncDomain,
} from '../connectors/erp-connector.interface';
import { ErpConnectionService } from '../services/erp-connection.service';
import { ErpSyncService } from '../services/erp-sync.service';
import { ErpAdminService } from '../services/erp-admin.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[erp] SKIPPING real-Postgres specs (erp-admin.integration.spec.ts): ' +
      'DATABASE_URL unset — must run against Postgres with the 1758000000001 migration applied.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const ENC_KEY = 'erp-admin-test-master-key-0123456789ABCDEF';
const THRESHOLD = 2;

describeReal('ERP operator control + circuit-breaker (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let admin: ErpAdminService;
  let sync: ErpSyncService;
  let connService: ErpConnectionService;
  let dispatchMock: jest.Mock;

  let orgId: string;
  let actorId: string; // acting SYSTEM_ADMIN

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              ERP_CREDENTIAL_ENC_KEY: ENC_KEY,
              ERP_CIRCUIT_BREAKER_ENABLED: true,
              ERP_CIRCUIT_BREAKER_THRESHOLD: THRESHOLD,
            }),
          ],
        }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([
          ErpConnection,
          ErpFieldMapping,
          ErpSyncJob,
          ErpCostRecord,
          User,
        ]),
      ],
      providers: [
        ErpAdminService,
        ErpSyncService,
        ErpConnectionService,
        CryptoService,
        SecurityEventService,
        MockErpConnector,
        SapCostConnector,
        {
          provide: ERP_CONNECTORS,
          useFactory: (m: MockErpConnector, s: SapCostConnector) => [m, s],
          inject: [MockErpConnector, SapCostConnector],
        },
        { provide: ERP_CONNECTOR_REGISTRY, useClass: ErpConnectorRegistry },
        // Mock dispatch (no Redis email queue) + mock erp-sync queue.
        { provide: NotificationDispatchService, useValue: { dispatch: jest.fn() } },
        { provide: getQueueToken('erp-sync-jobs'), useValue: { add: jest.fn() } },
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    admin = moduleRef.get(ErpAdminService);
    sync = moduleRef.get(ErpSyncService);
    connService = moduleRef.get(ErpConnectionService);
    dispatchMock = (moduleRef.get(NotificationDispatchService) as any).dispatch as jest.Mock;

    orgId = randomUUID();
    actorId = randomUUID();
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `erp-admin-test-org-${orgId.slice(0, 8)}`,
    ]);
    // Actor must exist (audit.user_id + hold_by_user_id FK→users). Also an
    // OWNER_ADMIN in the org so the notify lookup returns a recipient.
    await insertUser(actorId, orgId, 'SYSTEM_ADMIN');
    await insertUser(randomUUID(), orgId, 'OWNER_ADMIN');
  });

  async function insertUser(id: string, org: string, role: string) {
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, preferred_language,
         failed_login_attempts, onboarding_completed, onboarding_level,
         email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
         organization_id
       ) VALUES ($1, $2, $3, 'Erp', 'AdminTest', $4, 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $5)`,
      [id, `erp-admin-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.value.erp', role, org],
    );
  }

  async function makeConn(vendor: string): Promise<ErpConnection> {
    return dataSource.getRepository(ErpConnection).save(
      dataSource.getRepository(ErpConnection).create({
        organization_id: orgId,
        vendor,
        name: `${vendor} conn ${randomUUID().slice(0, 6)}`,
      }),
    );
  }

  async function auditFor(connId: string, action: string) {
    return dataSource.query(
      `SELECT action, user_id, organization_id, entity_id, new_values
       FROM audit_logs WHERE entity_type = 'erp_connection' AND entity_id = $1 AND action = $2`,
      [connId, action],
    );
  }

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM erp_connections WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM users WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await moduleRef?.close();
  });

  it('operator suspend → hold + audit; unsuspend → cleared + audit + counter reset', async () => {
    const conn = await makeConn('MOCK');
    await admin.suspend(conn.id, actorId, 'maintenance window');

    let row = await dataSource.getRepository(ErpConnection).findOneByOrFail({ id: conn.id });
    expect(row.operator_hold_state).toBe(ErpOperatorHoldState.OPERATOR_SUSPENDED);
    expect(row.hold_by_user_id).toBe(actorId);
    expect(row.hold_reason).toBe('maintenance window');

    const suspendAudit = await auditFor(conn.id, SECURITY_EVENT_TYPES.ERP_CONNECTION_SUSPENDED);
    expect(suspendAudit).toHaveLength(1);
    expect(suspendAudit[0].user_id).toBe(actorId);
    expect(suspendAudit[0].organization_id).toBe(orgId);
    expect(suspendAudit[0].new_values.reason).toBe('maintenance window');

    await admin.unsuspend(conn.id, actorId, 'resolved');
    row = await dataSource.getRepository(ErpConnection).findOneByOrFail({ id: conn.id });
    expect(row.operator_hold_state).toBe(ErpOperatorHoldState.NONE);
    expect(row.hold_by_user_id).toBeNull();
    expect(row.consecutive_failures).toBe(0);
    expect(await auditFor(conn.id, SECURITY_EVENT_TYPES.ERP_CONNECTION_UNSUSPENDED)).toHaveLength(1);
  });

  it('customer cannot re-enable or sync while operator-held', async () => {
    const conn = await makeConn('MOCK');
    await admin.suspend(conn.id, actorId, 'hold');

    await expect(
      connService.update(orgId, conn.id, { enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('guarded delete: rejected without a hold, allowed once held', async () => {
    const conn = await makeConn('MOCK');
    await expect(admin.remove(conn.id, actorId, 'cleanup')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await admin.suspend(conn.id, actorId, 'pre-delete');
    dispatchMock.mockClear();
    const res = await admin.remove(conn.id, actorId, 'decommission');
    expect(res).toEqual({ deleted: true, id: conn.id });
    expect(await dataSource.getRepository(ErpConnection).findOneBy({ id: conn.id })).toBeNull();
    expect(await auditFor(conn.id, SECURITY_EVENT_TYPES.ERP_CONNECTION_DELETED)).toHaveLength(1);
    // A distinct "removed" notification was dispatched to the org's OWNER_ADMIN(s).
    const removedCall = dispatchMock.mock.calls.find(
      (c) => c[0]?.relatedEntityId === conn.id && c[0]?.title === 'ERP Connection Removed',
    );
    expect(removedCall).toBeDefined();
  });

  it('circuit-breaker: failing force-checks increment then auto-suspend at threshold (actor=SYSTEM)', async () => {
    const conn = await makeConn('SAP'); // SAP skeleton healthCheck throws → failure

    await sync.executeForceCheck(conn.id); // failure #1
    let row = await dataSource.getRepository(ErpConnection).findOneByOrFail({ id: conn.id });
    expect(row.consecutive_failures).toBe(1);
    expect(row.operator_hold_state).toBe(ErpOperatorHoldState.NONE);

    await sync.executeForceCheck(conn.id); // failure #2 → trips (threshold=2)
    row = await dataSource.getRepository(ErpConnection).findOneByOrFail({ id: conn.id });
    expect(row.operator_hold_state).toBe(ErpOperatorHoldState.AUTO_SUSPENDED);
    expect(row.hold_by_user_id).toBeNull(); // SYSTEM actor

    const autoAudit = await auditFor(conn.id, SECURITY_EVENT_TYPES.ERP_CONNECTION_AUTO_SUSPENDED);
    expect(autoAudit).toHaveLength(1);
    expect(autoAudit[0].user_id).toBeNull(); // actor = SYSTEM
    expect(autoAudit[0].organization_id).toBe(orgId);
  });

  it('force-check happy path (Mock) → ok, status active, counter reset', async () => {
    const conn = await makeConn('MOCK');
    const result = await sync.executeForceCheck(conn.id);
    expect(result.ok).toBe(true);
    const row = await dataSource.getRepository(ErpConnection).findOneByOrFail({ id: conn.id });
    expect(row.status).toBe('active');
    expect(row.consecutive_failures).toBe(0);
  });
});
