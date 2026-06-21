import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';

import { CryptoService } from '../../../common/utils/crypto';
import { ErpConnection, ErpOperatorHoldState } from '../entities/erp-connection.entity';
import { ErpFieldMapping } from '../entities/erp-field-mapping.entity';
import { ErpSyncJob, ErpSyncJobStatus } from '../entities/erp-sync-job.entity';
import {
  ERP_CONNECTOR_REGISTRY,
  ErpSyncDirection,
  ErpSyncDomain,
  IErpConnectorRegistry,
} from '../connectors/erp-connector.interface';
import { CreateConnectionDto } from '../dto/create-connection.dto';
import { UpdateConnectionDto } from '../dto/update-connection.dto';
import { SetFieldMappingsDto } from '../dto/set-field-mappings.dto';

/**
 * Shape returned to clients. NEVER includes `credentials_encrypted` — that
 * field is @Exclude()'d on the entity AND explicitly omitted here (defense in
 * depth, independent of whether a ClassSerializerInterceptor is registered).
 */
export interface ErpConnectionResponse {
  id: string;
  organization_id: string;
  vendor: string;
  name: string;
  base_url: string | null;
  capabilities_snapshot: ErpConnection['capabilities_snapshot'];
  enabled: boolean;
  status: string;
  // Phase 7.28 v1.1 — operator hold surfaced so the customer UI can show the
  // blocked toggle + reason. `hold_by_user_id` is intentionally NOT exposed to
  // the customer (an internal operator id); operator-vs-auto is conveyed by the
  // state value.
  operator_hold_state: ErpOperatorHoldState;
  hold_reason: string | null;
  hold_at: Date | null;
  last_sync_at: Date | null;
  error_message: string | null;
  has_credentials: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Phase 7.28 — façade for ERP connection config + sync enqueue.
 *
 * EVERY query is org-scoped: the org id comes from the JWT (`@OrganizationId()`),
 * never from the client body, and every read/write carries
 * `organization_id = :orgId`. Credentials are encrypted on write via
 * CryptoService and never returned.
 */
@Injectable()
export class ErpConnectionService {
  private readonly logger = new Logger(ErpConnectionService.name);

  constructor(
    @InjectRepository(ErpConnection)
    private readonly connRepo: Repository<ErpConnection>,
    @InjectRepository(ErpFieldMapping)
    private readonly mappingRepo: Repository<ErpFieldMapping>,
    @InjectRepository(ErpSyncJob)
    private readonly jobRepo: Repository<ErpSyncJob>,
    @InjectQueue('erp-sync-jobs')
    private readonly queue: Queue,
    @Inject(ERP_CONNECTOR_REGISTRY)
    private readonly registry: IErpConnectorRegistry,
    private readonly crypto: CryptoService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Connections ─────────────────────────────────────────────────────────

  async create(
    orgId: string,
    dto: CreateConnectionDto,
  ): Promise<ErpConnectionResponse> {
    // Vendor must be a registry-known adapter (no DB enum — registry-driven).
    if (!this.registry.has(dto.vendor)) {
      throw new BadRequestException(
        `Unknown ERP vendor '${dto.vendor}'. Supported: ${this.registry
          .knownVendors()
          .join(', ')}.`,
      );
    }

    const row = this.connRepo.create({
      organization_id: orgId,
      vendor: dto.vendor,
      name: dto.name,
      base_url: dto.base_url ?? null,
      credentials_encrypted: this.encryptCredentials(dto.credentials),
      capabilities_snapshot: this.registry.capabilitiesFor(dto.vendor),
      enabled: dto.enabled ?? true,
    });
    const saved = await this.connRepo.save(row);
    this.logger.log(
      `ERP connection created org=${orgId} vendor=${dto.vendor} id=${saved.id}`,
    );
    return this.toResponse(saved);
  }

  async list(orgId: string): Promise<ErpConnectionResponse[]> {
    const rows = await this.connRepo.find({
      where: { organization_id: orgId },
      order: { created_at: 'DESC' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  async get(orgId: string, id: string): Promise<ErpConnectionResponse> {
    return this.toResponse(await this.loadOwned(orgId, id));
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateConnectionDto,
  ): Promise<ErpConnectionResponse> {
    const row = await this.loadOwned(orgId, id);

    // Operator hold: the customer can NEVER re-enable a connection on an
    // operator/auto hold, and can never touch the hold itself. Disabling
    // (enabled=false) their own connection stays allowed.
    if (
      dto.enabled === true &&
      row.operator_hold_state !== ErpOperatorHoldState.NONE
    ) {
      throw new ForbiddenException(
        'This connection has been suspended by operations and cannot be re-enabled. Contact SIGN support.',
      );
    }

    if (dto.name !== undefined) row.name = dto.name;
    if (dto.base_url !== undefined) row.base_url = dto.base_url;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    // Only re-encrypt when credentials are explicitly supplied; omitting the
    // field leaves the existing payload untouched.
    if (dto.credentials !== undefined) {
      row.credentials_encrypted = this.encryptCredentials(dto.credentials);
    }

    const saved = await this.connRepo.save(row);
    return this.toResponse(saved);
  }

  async remove(orgId: string, id: string): Promise<void> {
    const row = await this.loadOwned(orgId, id);
    await this.connRepo.remove(row);
  }

  // ─── Field mappings ──────────────────────────────────────────────────────

  async getMappings(orgId: string, id: string): Promise<ErpFieldMapping[]> {
    await this.loadOwned(orgId, id); // org-scope guard
    return this.mappingRepo.find({
      where: { connection_id: id },
      order: { source_field: 'ASC' },
    });
  }

  /** Full replacement of the connection's mapping set, transactionally. */
  async setMappings(
    orgId: string,
    id: string,
    dto: SetFieldMappingsDto,
  ): Promise<ErpFieldMapping[]> {
    await this.loadOwned(orgId, id); // org-scope guard

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ErpFieldMapping, { connection_id: id });
      if (dto.mappings.length > 0) {
        await manager.insert(
          ErpFieldMapping,
          dto.mappings.map((m) => ({
            connection_id: id,
            source_field: m.source_field,
            target_field: m.target_field,
          })),
        );
      }
    });

    return this.mappingRepo.find({
      where: { connection_id: id },
      order: { source_field: 'ASC' },
    });
  }

  // ─── Sync enqueue + job history ──────────────────────────────────────────

  /**
   * Enqueue a sync run. Capability-gated synchronously (clear 400 to the user)
   * AND re-gated in the worker. EXPORT is hard-rejected in v1 — the core never
   * auto-writes to an ERP. Job creation is idempotent: INSERT-first + ON
   * CONFLICT (connection_id, idempotency_key) DO NOTHING + return-existing.
   */
  async triggerSync(
    orgId: string,
    id: string,
    direction: ErpSyncDirection,
    domain: ErpSyncDomain,
    idempotencyKey?: string,
  ): Promise<{ jobId: string; reused: boolean }> {
    const conn = await this.loadOwned(orgId, id);

    // Operability = enabled AND no operator/auto hold.
    if (conn.operator_hold_state !== ErpOperatorHoldState.NONE) {
      throw new ForbiddenException(
        'This connection has been suspended by operations and cannot sync.',
      );
    }
    if (!conn.enabled) {
      throw new BadRequestException('Connection is disabled.');
    }

    if (direction === ErpSyncDirection.EXPORT) {
      throw new BadRequestException(
        'Export is not supported in v1 — SIGN never auto-writes to an ERP.',
      );
    }

    // Capability gate — branch on CAPABILITIES, never the vendor name.
    const caps = this.registry.capabilitiesFor(conn.vendor);
    if (!caps.directions.includes(direction)) {
      throw new BadRequestException(
        `Vendor '${conn.vendor}' does not support direction '${direction}'.`,
      );
    }
    if (!caps.domains.includes(domain)) {
      throw new BadRequestException(
        `Vendor '${conn.vendor}' does not support domain '${domain}'.`,
      );
    }

    const key = idempotencyKey ?? randomUUID();
    const { jobId, reused } = await this.createSyncJobIdempotent(
      conn.organization_id,
      id,
      direction,
      domain,
      key,
    );

    if (!reused) {
      await this.queue.add(
        'run-sync',
        { job_id: jobId },
        { attempts: 1, removeOnComplete: true, removeOnFail: false },
      );
    }
    this.logger.log(
      `ERP sync ${reused ? 'reused' : 'queued'} job=${jobId} conn=${id} ${direction}/${domain}`,
    );
    return { jobId, reused };
  }

  async listJobs(orgId: string, id: string): Promise<ErpSyncJob[]> {
    await this.loadOwned(orgId, id); // org-scope guard
    return this.jobRepo.find({
      where: { connection_id: id, organization_id: orgId },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  // Phase 7.28 v1.1 Part B — the SYSTEM_ADMIN cross-tenant list moved to
  // ErpAdminService.listConnections() (it returns the admin response shape with
  // resolved operator identity). The customer-facing methods above are unchanged.

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Idempotent job insert. INSERT-first + ON CONFLICT DO NOTHING + return the
   * existing row id (mirrors the metering Pattern-C shape). Same
   * (connection_id, idempotency_key) never creates two jobs.
   */
  private async createSyncJobIdempotent(
    orgId: string,
    connectionId: string,
    direction: ErpSyncDirection,
    domain: ErpSyncDomain,
    idempotencyKey: string,
  ): Promise<{ jobId: string; reused: boolean }> {
    const inserted = await this.dataSource.query(
      `
      INSERT INTO erp_sync_jobs
        (connection_id, organization_id, direction, domain, status, idempotency_key)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      ON CONFLICT (connection_id, idempotency_key) DO NOTHING
      RETURNING id
    `,
      [connectionId, orgId, direction, domain, idempotencyKey],
    );
    const insertedRows = this.readReturningRows(inserted);
    if (insertedRows.length > 0) {
      return { jobId: insertedRows[0].id as string, reused: false };
    }

    const existing = await this.dataSource.query(
      `SELECT id FROM erp_sync_jobs WHERE connection_id = $1 AND idempotency_key = $2`,
      [connectionId, idempotencyKey],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      throw new BadRequestException(
        'Failed to create sync job (idempotency conflict with no existing row).',
      );
    }
    return { jobId: existing[0].id as string, reused: true };
  }

  /** Load a connection scoped to the org, or 404. */
  private async loadOwned(orgId: string, id: string): Promise<ErpConnection> {
    const row = await this.connRepo.findOne({
      where: { id, organization_id: orgId },
    });
    if (!row) {
      throw new NotFoundException('ERP connection not found.');
    }
    return row;
  }

  /** Encrypt the credential object (or null when none/empty). */
  private encryptCredentials(
    credentials?: Record<string, unknown>,
  ): string | null {
    if (!credentials || Object.keys(credentials).length === 0) {
      return null;
    }
    return this.crypto.encrypt(JSON.stringify(credentials));
  }

  /** Strip the encrypted credential payload from every response. */
  private toResponse(row: ErpConnection): ErpConnectionResponse {
    return {
      id: row.id,
      organization_id: row.organization_id,
      vendor: row.vendor,
      name: row.name,
      base_url: row.base_url,
      capabilities_snapshot: row.capabilities_snapshot,
      enabled: row.enabled,
      status: row.status,
      operator_hold_state: row.operator_hold_state,
      hold_reason: row.hold_reason,
      hold_at: row.hold_at,
      last_sync_at: row.last_sync_at,
      error_message: row.error_message,
      has_credentials: !!row.credentials_encrypted,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
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
