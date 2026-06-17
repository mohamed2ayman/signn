import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { CryptoService } from '../../../common/utils/crypto';
import { ErpConnection } from '../entities/erp-connection.entity';
import { ErpFieldMapping } from '../entities/erp-field-mapping.entity';
import { ErpSyncJob } from '../entities/erp-sync-job.entity';
import { ErpCostRecord } from '../entities/erp-cost-record.entity';
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
import { ErpSyncJobStatus } from '../entities/erp-sync-job.entity';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Needs real Postgres (DATABASE_URL set). CI is unit-test ONLY (CLAUDE.md), so
// skip LOUDLY when unset — a silent skip would read green without proving the
// engine works end-to-end. data-source.ts throws at module load when
// DATABASE_URL is unset, so it is required lazily inside beforeAll.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[erp] SKIPPING real-Postgres specs (erp-sync.integration.spec.ts): ' +
      'DATABASE_URL unset — these MUST run against Postgres (dev/staging) with ' +
      'the 1757000000001 migration applied. CI green here does NOT prove the ' +
      'ERP sync engine is verified.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const ENC_KEY = 'erp-integration-test-master-key-0123456789';

const MOCK_MAPPINGS = {
  mappings: [
    { source_field: 'cost_center', target_field: 'cost_code' },
    { source_field: 'wbs', target_field: 'wbs_ref' },
    { source_field: 'value', target_field: 'amount' },
    { source_field: 'curr', target_field: 'currency' },
    { source_field: 'period', target_field: 'period' },
    { source_field: 'desc', target_field: 'description' },
  ],
};

describeReal('ERP sync engine (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let connService: ErpConnectionService;
  let syncService: ErpSyncService;

  let orgId: string;
  let orgBId: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ ERP_CREDENTIAL_ENC_KEY: ENC_KEY })],
        }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([
          ErpConnection,
          ErpFieldMapping,
          ErpSyncJob,
          ErpCostRecord,
        ]),
      ],
      providers: [
        ErpConnectionService,
        ErpSyncService,
        CryptoService,
        MockErpConnector,
        SapCostConnector,
        {
          provide: ERP_CONNECTORS,
          useFactory: (m: MockErpConnector, s: SapCostConnector) => [m, s],
          inject: [MockErpConnector, SapCostConnector],
        },
        { provide: ERP_CONNECTOR_REGISTRY, useClass: ErpConnectorRegistry },
        // Mock queue — call executeJob() directly; no Redis, no processor race.
        { provide: getQueueToken('erp-sync-jobs'), useValue: { add: jest.fn() } },
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    connService = moduleRef.get(ErpConnectionService);
    syncService = moduleRef.get(ErpSyncService);

    orgId = randomUUID();
    orgBId = randomUUID();
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgId, `erp-test-org-${orgId.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgBId, `erp-test-org-b-${orgBId.slice(0, 8)}`],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Cascade removes connections → mappings, jobs, cost records.
      await dataSource.query(
        `DELETE FROM erp_connections WHERE organization_id = ANY($1)`,
        [[orgId, orgBId]],
      );
      await dataSource.query(
        `DELETE FROM organizations WHERE id = ANY($1)`,
        [[orgId, orgBId]],
      );
    }
    await moduleRef?.close();
  });

  it('Mock adapter drives a full import end-to-end → neutral cost rows', async () => {
    const conn = await connService.create(orgId, {
      vendor: 'MOCK',
      name: 'Mock Conn',
      credentials: { apiKey: 'k' },
    });
    await connService.setMappings(orgId, conn.id, MOCK_MAPPINGS);

    const { jobId } = await connService.triggerSync(
      orgId,
      conn.id,
      ErpSyncDirection.IMPORT,
      ErpSyncDomain.COST,
    );
    const res = await syncService.executeJob(jobId);

    expect(res.ran).toBe(true);
    expect(res.status).toBe(ErpSyncJobStatus.SUCCESS);
    expect(res.imported).toBe(3);
    expect(res.failed).toBe(0);

    const rows = await dataSource.query(
      `SELECT cost_code, wbs_ref, amount, currency, period, description, organization_id
       FROM erp_cost_records WHERE connection_id = $1 ORDER BY external_ref`,
      [conn.id],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].cost_code).toBe('CC-100');
    expect(rows[0].wbs_ref).toBe('WBS-1.1');
    expect(Number(rows[0].amount)).toBe(125000.5);
    expect(rows[0].currency).toBe('EGP');
    expect(rows[0].organization_id).toBe(orgId); // subject = connection's org
  });

  it('re-import is idempotent (upsert on external_ref — no duplicate rows)', async () => {
    const conn = await connService.create(orgId, { vendor: 'MOCK', name: 'Reimport' });
    await connService.setMappings(orgId, conn.id, MOCK_MAPPINGS);

    const a = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST);
    await syncService.executeJob(a.jobId);
    const b = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST);
    const res2 = await syncService.executeJob(b.jobId);

    expect(res2.imported).toBe(3);
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM erp_cost_records WHERE connection_id = $1`,
      [conn.id],
    );
    expect(count).toBe(3); // still 3, not 6
  });

  it('job-state transition is idempotent (terminal job re-execute = no-op)', async () => {
    const conn = await connService.create(orgId, { vendor: 'MOCK', name: 'StateGuard' });
    await connService.setMappings(orgId, conn.id, MOCK_MAPPINGS);
    const { jobId } = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST);

    const first = await syncService.executeJob(jobId);
    expect(first.ran).toBe(true);
    const second = await syncService.executeJob(jobId); // already terminal
    expect(second.ran).toBe(false);
  });

  it('enqueue is idempotent on a reused idempotency_key', async () => {
    const conn = await connService.create(orgId, { vendor: 'MOCK', name: 'IdemKey' });
    const key = `fixed-${randomUUID()}`;
    const a = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST, key);
    const b = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST, key);
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(b.jobId).toBe(a.jobId);
  });

  it('capability gate rejects unsupported domain and EXPORT direction', async () => {
    const conn = await connService.create(orgId, { vendor: 'MOCK', name: 'CapGate' });
    await expect(
      connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.SCHEDULE),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      connService.triggerSync(orgId, conn.id, ErpSyncDirection.EXPORT, ErpSyncDomain.COST),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces org-scope on reads (other org cannot see or reach a connection)', async () => {
    const conn = await connService.create(orgId, { vendor: 'MOCK', name: 'OrgScoped' });
    await expect(connService.get(orgBId, conn.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(connService.listJobs(orgBId, conn.id)).rejects.toBeInstanceOf(NotFoundException);
    const listForB = await connService.list(orgBId);
    expect(listForB.find((c) => c.id === conn.id)).toBeUndefined();
  });

  it('SAP skeleton registers + resolves via the registry, then fails NotImplemented', async () => {
    const conn = await connService.create(orgId, { vendor: 'SAP', name: 'SAP Conn' });
    const { jobId } = await connService.triggerSync(orgId, conn.id, ErpSyncDirection.IMPORT, ErpSyncDomain.COST);
    const res = await syncService.executeJob(jobId);

    expect(res.status).toBe(ErpSyncJobStatus.FAILED);
    const [job] = await dataSource.query(
      `SELECT error FROM erp_sync_jobs WHERE id = $1`,
      [jobId],
    );
    expect(job.error).toMatch(/not yet operational/i);
  });

  it('credentials are encrypted at rest, decrypt back, and are never returned', async () => {
    const conn = await connService.create(orgId, {
      vendor: 'MOCK',
      name: 'Creds',
      credentials: { apiKey: 'top-secret', user: 'svc' },
    });
    expect(conn).not.toHaveProperty('credentials_encrypted');
    expect(conn.has_credentials).toBe(true);

    const [row] = await dataSource.query(
      `SELECT credentials_encrypted FROM erp_connections WHERE id = $1`,
      [conn.id],
    );
    expect(row.credentials_encrypted).toMatch(/^v1\./);

    const crypto = new CryptoService({
      get: (k: string) => (k === 'ERP_CREDENTIAL_ENC_KEY' ? ENC_KEY : undefined),
    } as any);
    expect(JSON.parse(crypto.decrypt(row.credentials_encrypted))).toEqual({
      apiKey: 'top-secret',
      user: 'svc',
    });
  });
});
