import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { CryptoService } from '../../../common/utils/crypto';
import { ErpConnection, ErpConnectionStatus } from '../entities/erp-connection.entity';
import { ErpFieldMapping } from '../entities/erp-field-mapping.entity';
import { ErpSyncJob, ErpSyncJobStatus } from '../entities/erp-sync-job.entity';
import {
  ERP_CONNECTOR_REGISTRY,
  ErpConnectorContext,
  ErpSyncDirection,
  ErpSyncDomain,
  IErpConnectorRegistry,
} from '../connectors/erp-connector.interface';
import { mapRawToNeutral, NeutralCostRecord } from './erp-cost-mapper';
import { ErpAdminService } from './erp-admin.service';

/** Result of a force-check probe (for the processor + tests). */
export interface ForceCheckResult {
  ok: boolean;
  detail?: string;
}

/** Outcome of one job execution (returned for tests + processor logging). */
export interface ExecuteResult {
  status: ErpSyncJobStatus;
  processed: number;
  imported: number;
  failed: number;
  /** false when the job was already claimed/terminal (no-op execution guard). */
  ran: boolean;
}

/**
 * Phase 7.28 — ERP sync ENGINE (worker side).
 *
 * Vendor-neutral: resolves the adapter at job time from the connection's vendor
 * via the registry, gates on CAPABILITIES (never the vendor name), decrypts
 * credentials ONLY here in the worker, runs the import, projects raw records
 * onto SIGN's neutral cost shape via the connection's field mappings, and
 * upserts neutral rows idempotently. State transitions are status-guarded
 * conditional UPDATEs (mirrors the metering ledger), fail-safe toward
 * partial-not-corrupt. The subject is always the connection's own
 * organization_id — never client-supplied.
 */
@Injectable()
export class ErpSyncService {
  private readonly logger = new Logger(ErpSyncService.name);

  constructor(
    @InjectRepository(ErpConnection)
    private readonly connRepo: Repository<ErpConnection>,
    @InjectRepository(ErpFieldMapping)
    private readonly mappingRepo: Repository<ErpFieldMapping>,
    @InjectRepository(ErpSyncJob)
    private readonly jobRepo: Repository<ErpSyncJob>,
    @Inject(ERP_CONNECTOR_REGISTRY)
    private readonly registry: IErpConnectorRegistry,
    private readonly crypto: CryptoService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly erpAdmin: ErpAdminService,
  ) {}

  /**
   * Execute a sync job by id. Idempotent execution: a status-guarded claim
   * (`pending → running`) ensures only one worker proceeds; a re-delivered or
   * already-terminal job is a logged no-op.
   */
  async executeJob(jobId: string): Promise<ExecuteResult> {
    // ── Claim: pending → running (status-guarded; only one worker wins) ──
    const claimRaw = await this.dataSource.query(
      `
      UPDATE erp_sync_jobs
      SET    status = 'running', started_at = NOW()
      WHERE  id = $1 AND status = 'pending'
      RETURNING connection_id, organization_id, direction, domain
    `,
      [jobId],
    );
    const claimed = this.readReturningRows(claimRaw);
    if (claimed.length === 0) {
      const [cur] = await this.dataSource.query(
        `SELECT status FROM erp_sync_jobs WHERE id = $1`,
        [jobId],
      );
      this.logger.warn(
        `ERP sync job ${jobId} not claimable (status=${cur?.status ?? 'missing'}) — no-op`,
      );
      return {
        status: (cur?.status as ErpSyncJobStatus) ?? ErpSyncJobStatus.FAILED,
        processed: 0,
        imported: 0,
        failed: 0,
        ran: false,
      };
    }

    const job = claimed[0] as {
      connection_id: string;
      organization_id: string;
      direction: ErpSyncDirection;
      domain: ErpSyncDomain;
    };

    try {
      const result = await this.runImport(jobId, job);
      const finalStatus =
        result.failed > 0 ? ErpSyncJobStatus.PARTIAL : ErpSyncJobStatus.SUCCESS;

      await this.finishJob(jobId, finalStatus, result, null);
      await this.connRepo.update(job.connection_id, {
        last_sync_at: new Date(),
        status: ErpConnectionStatus.ACTIVE,
        error_message: null,
        consecutive_failures: 0, // success resets the circuit-breaker counter
      });
      this.logger.log(
        `ERP sync ${jobId} ${finalStatus}: processed=${result.processed} imported=${result.imported} failed=${result.failed}`,
      );
      return { ...result, status: finalStatus, ran: true };
    } catch (err) {
      const message = this.safeError(err);
      await this.finishJob(
        jobId,
        ErpSyncJobStatus.FAILED,
        { processed: 0, imported: 0, failed: 0 },
        message,
      );
      await this.connRepo.update(job.connection_id, {
        status: ErpConnectionStatus.ERROR,
        error_message: message,
      });
      await this.registerFailure(job.connection_id, message);
      this.logger.error(`ERP sync ${jobId} FAILED: ${message}`);
      return {
        status: ErpSyncJobStatus.FAILED,
        processed: 0,
        imported: 0,
        failed: 0,
        ran: true,
      };
    }
  }

  /**
   * Phase 7.28 v1.1 — operator force-check (worker side). Makes a real outbound
   * call via the connector's healthCheck with credentials decrypted ONLY here.
   * Updates the connection's status/error_message; a failed check increments the
   * circuit-breaker counter (and may trip it). Never writes cost data.
   */
  async executeForceCheck(connectionId: string): Promise<ForceCheckResult> {
    const conn = await this.connRepo.findOne({ where: { id: connectionId } });
    if (!conn) {
      this.logger.warn(`ERP force-check: connection ${connectionId} not found — no-op`);
      return { ok: false, detail: 'connection not found' };
    }

    try {
      const connector = this.registry.resolve(conn.vendor);
      const ctx: ErpConnectorContext = {
        connectionId: conn.id,
        organizationId: conn.organization_id,
        baseUrl: conn.base_url,
        credentials: this.decryptCredentials(conn.credentials_encrypted),
        domain: ErpSyncDomain.COST,
      };
      const result = await connector.healthCheck(ctx);
      if (result.ok) {
        await this.connRepo.update(conn.id, {
          status: ErpConnectionStatus.ACTIVE,
          error_message: null,
          consecutive_failures: 0,
        });
        this.logger.log(`ERP force-check OK conn=${conn.id}`);
        return result;
      }
      const detail = result.detail ?? 'Health check reported not ok';
      await this.connRepo.update(conn.id, {
        status: ErpConnectionStatus.ERROR,
        error_message: detail,
      });
      await this.registerFailure(conn.id, detail);
      return { ok: false, detail };
    } catch (err) {
      const message = this.safeError(err);
      await this.connRepo.update(conn.id, {
        status: ErpConnectionStatus.ERROR,
        error_message: message,
      });
      await this.registerFailure(conn.id, message);
      this.logger.warn(`ERP force-check FAILED conn=${conn.id}: ${message}`);
      return { ok: false, detail: message };
    }
  }

  /**
   * Circuit-breaker: atomically increment the connection's consecutive-failure
   * counter; if it crosses the configured threshold (and the breaker is enabled),
   * auto-suspend via the shared system path (actor = SYSTEM).
   */
  private async registerFailure(
    connectionId: string,
    message: string,
  ): Promise<void> {
    const res = await this.dataSource.query(
      `UPDATE erp_connections
       SET consecutive_failures = consecutive_failures + 1
       WHERE id = $1
       RETURNING consecutive_failures`,
      [connectionId],
    );
    const rows = this.readReturningRows(res);
    const count = rows.length ? Number(rows[0].consecutive_failures) : 0;

    if (!this.config.get<boolean>('ERP_CIRCUIT_BREAKER_ENABLED', true)) return;
    const threshold = Number(
      this.config.get<number>('ERP_CIRCUIT_BREAKER_THRESHOLD', 5),
    );
    if (count >= threshold) {
      await this.erpAdmin.autoSuspend(
        connectionId,
        `Auto-suspended after ${count} consecutive failures (threshold ${threshold}). Last error: ${message}`,
      );
    }
  }

  // ─── Import pipeline ───────────────────────────────────────────────────────

  private async runImport(
    jobId: string,
    job: {
      connection_id: string;
      organization_id: string;
      direction: ErpSyncDirection;
      domain: ErpSyncDomain;
    },
  ): Promise<{ processed: number; imported: number; failed: number }> {
    // Defense in depth: the core NEVER auto-writes to an ERP in v1.
    if (job.direction === ErpSyncDirection.EXPORT) {
      throw new Error('Export is not supported in v1 — SIGN never auto-writes to an ERP.');
    }

    const conn = await this.connRepo.findOne({
      where: { id: job.connection_id },
    });
    if (!conn) {
      throw new Error('Connection no longer exists.');
    }

    // Capability gate — branch on CAPABILITIES, never the vendor name.
    const caps = this.registry.capabilitiesFor(conn.vendor);
    if (!caps.directions.includes(job.direction)) {
      throw new Error(`Vendor '${conn.vendor}' does not support direction '${job.direction}'.`);
    }
    if (!caps.domains.includes(job.domain)) {
      throw new Error(`Vendor '${conn.vendor}' does not support domain '${job.domain}'.`);
    }

    const connector = this.registry.resolve(conn.vendor);
    const ctx: ErpConnectorContext = {
      connectionId: conn.id,
      organizationId: conn.organization_id, // subject — never client-supplied
      baseUrl: conn.base_url,
      credentials: this.decryptCredentials(conn.credentials_encrypted),
      domain: job.domain,
    };

    // v1: only COST import is implemented end-to-end.
    if (job.domain !== ErpSyncDomain.COST) {
      throw new Error(`Domain '${job.domain}' import is not implemented in v1.`);
    }

    const raw = await connector.importCostData(ctx);
    const mappings = await this.mappingRepo.find({
      where: { connection_id: conn.id },
    });

    let imported = 0;
    let failed = 0;
    for (const rec of raw) {
      const mapped = mapRawToNeutral(rec, mappings);
      if (!mapped) {
        failed += 1;
        continue;
      }
      await this.upsertCostRecord(conn.organization_id, conn.id, jobId, mapped);
      imported += 1;
    }

    return { processed: raw.length, imported, failed };
  }

  /** Idempotent neutral upsert keyed by UNIQUE(connection_id, external_ref). */
  private async upsertCostRecord(
    orgId: string,
    connectionId: string,
    jobId: string,
    rec: NeutralCostRecord,
  ): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO erp_cost_records
        (organization_id, connection_id, sync_job_id, external_ref, cost_code,
         wbs_ref, period, amount, currency, description, imported_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (connection_id, external_ref) DO UPDATE SET
        sync_job_id = EXCLUDED.sync_job_id,
        cost_code   = EXCLUDED.cost_code,
        wbs_ref     = EXCLUDED.wbs_ref,
        period      = EXCLUDED.period,
        amount      = EXCLUDED.amount,
        currency    = EXCLUDED.currency,
        description = EXCLUDED.description,
        imported_at = NOW()
    `,
      [
        orgId,
        connectionId,
        jobId,
        rec.external_ref,
        rec.cost_code,
        rec.wbs_ref,
        rec.period,
        rec.amount,
        rec.currency,
        rec.description,
      ],
    );
  }

  /** Status-guarded job completion (running → terminal). At-most-once. */
  private async finishJob(
    jobId: string,
    status: ErpSyncJobStatus,
    counts: { processed: number; imported: number; failed: number },
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `
      UPDATE erp_sync_jobs
      SET    status = $2,
             records_processed = $3,
             records_imported = $4,
             records_failed = $5,
             error = $6,
             finished_at = NOW()
      WHERE  id = $1 AND status = 'running'
    `,
      [jobId, status, counts.processed, counts.imported, counts.failed, error],
    );
  }

  /** Decrypt credentials — ONLY here, in the worker. Never logged. */
  private decryptCredentials(
    encrypted: string | null,
  ): Record<string, unknown> | null {
    if (!encrypted) return null;
    let plaintext: string;
    try {
      plaintext = this.crypto.decrypt(encrypted);
    } catch {
      // Generic message — never echo the crypto error (which is already
      // key/plaintext-free, but stay defensive) or any payload.
      throw new Error('Credential decryption failed for this connection.');
    }
    try {
      return JSON.parse(plaintext) as Record<string, unknown>;
    } catch {
      throw new Error('Stored credentials are not valid JSON.');
    }
  }

  /** Error message with no credential/payload leakage. */
  private safeError(err: unknown): string {
    const msg = (err as Error)?.message ?? 'Unknown error';
    return msg.slice(0, 500);
  }

  private readReturningRows(raw: unknown): Array<Record<string, any>> {
    if (Array.isArray(raw) && Array.isArray(raw[0])) {
      return raw[0] as Array<Record<string, any>>;
    }
    if (Array.isArray(raw)) {
      return raw as Array<Record<string, any>>;
    }
    return [];
  }
}
