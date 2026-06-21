import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { Queue } from 'bull';

import { User, UserRole, NotificationType } from '../../../database/entities';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import {
  erpConnectionSuspendedEmail,
  erpConnectionRestoredEmail,
  erpConnectionRemovedEmail,
} from '../../notifications/templates';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import {
  ErpConnection,
  ErpOperatorHoldState,
} from '../entities/erp-connection.entity';

/** Admin-facing connection view — never includes the encrypted credential blob. */
export interface ErpAdminConnectionResponse {
  id: string;
  organization_id: string;
  vendor: string;
  name: string;
  status: string;
  enabled: boolean;
  operator_hold_state: ErpOperatorHoldState;
  hold_reason: string | null;
  hold_by_user_id: string | null;
  /** Resolved operator identity (Phase 7.28 v1.1 Part B). Null for auto-suspended
   * (actor = SYSTEM), for no hold, or if the operator's user row is gone. */
  hold_by_name: string | null;
  hold_by_email: string | null;
  hold_at: Date | null;
  consecutive_failures: number;
  last_sync_at: Date | null;
  error_message: string | null;
  has_credentials: boolean;
  created_at: Date;
  updated_at: Date;
}

type NotifyEvent = 'suspended' | 'auto_suspended' | 'unsuspended' | 'removed';

/**
 * Phase 7.28 v1.1 — DELIBERATE cross-tenant SYSTEM_ADMIN authority over ERP
 * connections (suspend / unsuspend / force-check / guarded-delete) + the
 * circuit-breaker's auto-suspend.
 *
 * Cross-tenant safety here is NOT the Option B contract-chokepoint — ERP
 * connections are ORG-scoped (direct organization_id), not contract-scoped, so
 * the `no-bare-contract-repo-access` lint never applies (finding #0). Safety =
 * (1) the SYSTEM_ADMIN role gate on the controller + (2) a reason-required,
 * immutable audit row on every action. This mirrors admin-organizations.service.
 *
 * Operators govern PERMISSION TO OPERATE only: they flip the hold and read
 * health. They never see/enter/edit credentials, never create connections,
 * never edit mappings, never sync on the customer's behalf, never see synced
 * data.
 */
@Injectable()
export class ErpAdminService {
  private readonly logger = new Logger(ErpAdminService.name);

  constructor(
    @InjectRepository(ErpConnection)
    private readonly connRepo: Repository<ErpConnection>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectQueue('erp-sync-jobs')
    private readonly queue: Queue,
    private readonly securityEvents: SecurityEventService,
    private readonly dispatch: NotificationDispatchService,
    private readonly config: ConfigService,
  ) {}

  // ─── Operator actions ──────────────────────────────────────────────────────

  /** Manually suspend a connection (operator hold). */
  async suspend(
    connectionId: string,
    adminUserId: string,
    reason: string,
  ): Promise<ErpAdminConnectionResponse> {
    const conn = await this.loadOrThrow(connectionId);
    if (conn.operator_hold_state !== ErpOperatorHoldState.NONE) {
      throw new BadRequestException('Connection is already on an operator hold.');
    }

    await this.securityEvents.recordAtomic(
      {
        type: SECURITY_EVENT_TYPES.ERP_CONNECTION_SUSPENDED,
        actor_id: adminUserId,
        organization_id: conn.organization_id,
        entity_type: 'erp_connection',
        entity_id: conn.id,
        metadata: { reason, vendor: conn.vendor, name: conn.name },
      },
      async (em) => {
        await em.update(ErpConnection, conn.id, {
          operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED,
          hold_reason: reason,
          hold_by_user_id: adminUserId,
          hold_at: new Date(),
        });
      },
    );

    await this.notifyOrgAdmins(conn, 'suspended', reason);
    this.logger.log(`ERP connection ${conn.id} suspended by ${adminUserId}`);
    return this.toAdminResponse(await this.loadOrThrow(connectionId));
  }

  /** Lift an operator/auto hold — only an operator can clear it. */
  async unsuspend(
    connectionId: string,
    adminUserId: string,
    reason: string,
  ): Promise<ErpAdminConnectionResponse> {
    const conn = await this.loadOrThrow(connectionId);
    if (conn.operator_hold_state === ErpOperatorHoldState.NONE) {
      throw new BadRequestException('Connection is not on an operator hold.');
    }

    await this.securityEvents.recordAtomic(
      {
        type: SECURITY_EVENT_TYPES.ERP_CONNECTION_UNSUSPENDED,
        actor_id: adminUserId,
        organization_id: conn.organization_id,
        entity_type: 'erp_connection',
        entity_id: conn.id,
        metadata: { reason, vendor: conn.vendor, name: conn.name },
      },
      async (em) => {
        await em.update(ErpConnection, conn.id, {
          operator_hold_state: ErpOperatorHoldState.NONE,
          hold_reason: null,
          hold_by_user_id: null,
          hold_at: null,
          consecutive_failures: 0, // fresh start once the hold is cleared
        });
      },
    );

    await this.notifyOrgAdmins(conn, 'unsuspended', reason);
    this.logger.log(`ERP connection ${conn.id} unsuspended by ${adminUserId}`);
    return this.toAdminResponse(await this.loadOrThrow(connectionId));
  }

  /**
   * Guarded delete — allowed ONLY when the connection is already on an active
   * hold (operator_suspended OR auto_suspended). Never a one-click delete on a
   * live connection. Cascades to jobs / mappings / cost records via FKs.
   */
  async remove(
    connectionId: string,
    adminUserId: string,
    reason: string,
  ): Promise<{ deleted: true; id: string }> {
    const conn = await this.loadOrThrow(connectionId);
    if (conn.operator_hold_state === ErpOperatorHoldState.NONE) {
      throw new BadRequestException(
        'Connection must be suspended before it can be deleted.',
      );
    }

    // Capture org/identity AND resolve the recipient list BEFORE the hard
    // delete — once the row is gone its org linkage is too. (Users survive the
    // cascade, but resolving first guarantees recipients regardless and avoids
    // any reliance on post-delete state.)
    const orgId = conn.organization_id;
    const admins = await this.loadOrgAdmins(orgId);

    await this.securityEvents.recordAtomic(
      {
        type: SECURITY_EVENT_TYPES.ERP_CONNECTION_DELETED,
        actor_id: adminUserId,
        organization_id: orgId,
        entity_type: 'erp_connection',
        entity_id: conn.id,
        metadata: { reason, vendor: conn.vendor, name: conn.name },
      },
      async (em) => {
        await em.delete(ErpConnection, conn.id);
      },
    );

    // Notify ONLY after the delete actually committed — "removed" is a distinct
    // event (their connection is gone and must be rebuilt). Best-effort.
    await this.dispatchToAdmins(admins, conn, 'removed', reason);

    this.logger.log(`ERP connection ${connectionId} deleted by ${adminUserId}`);
    return { deleted: true, id: connectionId };
  }

  /**
   * Enqueue a server-side force-check. The actual outbound call (with decrypted
   * creds) runs in the worker — the credential never reaches the operator's
   * session. The "requested" event is audited fire-and-forget here; the result
   * surfaces on the connection's status/error_message.
   */
  async requestForceCheck(
    connectionId: string,
    adminUserId: string,
    reason: string,
  ): Promise<{ enqueued: true; connectionId: string }> {
    const conn = await this.loadOrThrow(connectionId);

    await this.queue.add(
      'force-check',
      { connection_id: conn.id },
      { attempts: 1, removeOnComplete: true, removeOnFail: false },
    );

    // Fire-and-forget — the request itself is the auditable event.
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.ERP_CONNECTION_FORCE_CHECK,
      actor_id: adminUserId,
      organization_id: conn.organization_id,
      entity_type: 'erp_connection',
      entity_id: conn.id,
      metadata: { reason, vendor: conn.vendor, name: conn.name },
    });

    this.logger.log(`ERP force-check queued conn=${conn.id} by ${adminUserId}`);
    return { enqueued: true, connectionId: conn.id };
  }

  // ─── Circuit-breaker auto-suspend (actor = SYSTEM) ─────────────────────────

  /**
   * Auto-suspend invoked by the sync engine's circuit-breaker. Same hold
   * mechanism as the operator path, but actor = SYSTEM (no hold_by_user_id) and
   * a distinct audit event. No-op if a hold is already in place.
   */
  async autoSuspend(connectionId: string, reason: string): Promise<void> {
    const conn = await this.connRepo.findOne({ where: { id: connectionId } });
    if (!conn || conn.operator_hold_state !== ErpOperatorHoldState.NONE) {
      return; // already gone or already held — never double-suspend/notify
    }

    await this.securityEvents.recordAtomic(
      {
        type: SECURITY_EVENT_TYPES.ERP_CONNECTION_AUTO_SUSPENDED,
        actor_id: null, // SYSTEM actor
        organization_id: conn.organization_id,
        entity_type: 'erp_connection',
        entity_id: conn.id,
        metadata: { reason, vendor: conn.vendor, name: conn.name },
      },
      async (em) => {
        await em.update(ErpConnection, conn.id, {
          operator_hold_state: ErpOperatorHoldState.AUTO_SUSPENDED,
          hold_reason: reason,
          hold_by_user_id: null,
          hold_at: new Date(),
        });
      },
    );

    await this.notifyOrgAdmins(conn, 'auto_suspended', reason);
    this.logger.warn(`ERP connection ${conn.id} AUTO-SUSPENDED: ${reason}`);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async loadOrThrow(connectionId: string): Promise<ErpConnection> {
    const conn = await this.connRepo.findOne({ where: { id: connectionId } });
    if (!conn) {
      throw new NotFoundException('ERP connection not found.');
    }
    return conn;
  }

  /** Resolve + dispatch in one step (suspend / unsuspend / auto-suspend). */
  private async notifyOrgAdmins(
    conn: ErpConnection,
    event: NotifyEvent,
    reason: string,
  ): Promise<void> {
    const admins = await this.loadOrgAdmins(conn.organization_id);
    await this.dispatchToAdmins(admins, conn, event, reason);
  }

  /**
   * Look up the TARGET org's active OWNER_ADMIN(s) (cross-org — the acting
   * SYSTEM_ADMIN is elsewhere). Best-effort: a lookup failure returns [] and
   * never throws. Resolved BEFORE a delete so recipients survive the cascade.
   */
  private async loadOrgAdmins(organizationId: string): Promise<User[]> {
    try {
      return await this.userRepo.find({
        where: {
          organization_id: organizationId,
          role: UserRole.OWNER_ADMIN,
          is_active: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `ERP notify: failed to load admins for org ${organizationId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Dispatch the per-event notification (in-app + email) to each admin.
   * Best-effort per admin: a notify failure NEVER rolls back the originating
   * action (lesson #114). `conn` may be a pre-delete snapshot for 'removed'.
   */
  private async dispatchToAdmins(
    admins: User[],
    conn: ErpConnection,
    event: NotifyEvent,
    reason: string,
  ): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const connectionsLink = `${frontendUrl}/app/erp-connections`;

    let title: string;
    let message: string;
    let subject: string;
    let html: string;

    if (event === 'unsuspended') {
      title = 'ERP Connection Restored';
      message = `The operations hold on your ERP connection "${conn.name}" has been lifted.`;
      subject = `SIGN — ERP connection restored: ${conn.name}`;
      html = erpConnectionRestoredEmail({ connectionName: conn.name, vendor: conn.vendor, reason, connectionsLink });
    } else if (event === 'removed') {
      title = 'ERP Connection Removed';
      message = `Your ERP connection "${conn.name}" was removed by platform operations and must be set up again to resume syncing. Reason: ${reason}`;
      subject = `SIGN — ERP connection removed: ${conn.name}`;
      html = erpConnectionRemovedEmail({ connectionName: conn.name, vendor: conn.vendor, reason, connectionsLink });
    } else {
      title = 'ERP Connection Suspended';
      message = `Your ERP connection "${conn.name}" has been suspended${event === 'auto_suspended' ? ' automatically after repeated failures' : ' by operations'}.`;
      subject = `SIGN — ERP connection suspended: ${conn.name}`;
      html = erpConnectionSuspendedEmail({
        connectionName: conn.name,
        vendor: conn.vendor,
        reason,
        automatic: event === 'auto_suspended',
        connectionsLink,
      });
    }

    for (const admin of admins) {
      try {
        await this.dispatch.dispatch({
          userId: admin.id,
          title,
          message,
          type: NotificationType.BOTH,
          relatedEntityType: 'erp_connection',
          relatedEntityId: conn.id,
          email: { to: admin.email, subject, html, templateName: `erp-${event}` },
        });
      } catch (err) {
        this.logger.error(
          `ERP notify: failed to notify admin ${admin.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Cross-tenant admin list (Phase 7.28 v1.1 Part B). Returns the ADMIN response
   * shape (with hold_by_user_id) and resolves the operator identity (name/email)
   * via a single batch lookup. SYSTEM_ADMIN-gated cross-tenant path (finding #0;
   * ERP is org-scoped, not contract-scoped — no tenant-repo violation).
   */
  async listConnections(): Promise<ErpAdminConnectionResponse[]> {
    const rows = await this.connRepo.find({ order: { created_at: 'DESC' } });

    const holderIds = [
      ...new Set(
        rows.map((r) => r.hold_by_user_id).filter((id): id is string => !!id),
      ),
    ];
    const holders = holderIds.length
      ? await this.userRepo.find({ where: { id: In(holderIds) } })
      : [];
    const byId = new Map(holders.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = r.hold_by_user_id ? byId.get(r.hold_by_user_id) : undefined;
      const name = u
        ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || null
        : null;
      return this.toAdminResponse(r, { name, email: u?.email ?? null });
    });
  }

  private toAdminResponse(
    conn: ErpConnection,
    holder: { name: string | null; email: string | null } = {
      name: null,
      email: null,
    },
  ): ErpAdminConnectionResponse {
    return {
      id: conn.id,
      organization_id: conn.organization_id,
      vendor: conn.vendor,
      name: conn.name,
      status: conn.status,
      enabled: conn.enabled,
      operator_hold_state: conn.operator_hold_state,
      hold_reason: conn.hold_reason,
      hold_by_user_id: conn.hold_by_user_id,
      hold_by_name: holder.name,
      hold_by_email: holder.email,
      hold_at: conn.hold_at,
      consecutive_failures: conn.consecutive_failures,
      last_sync_at: conn.last_sync_at,
      error_message: conn.error_message,
      has_credentials: !!conn.credentials_encrypted,
      created_at: conn.created_at,
      updated_at: conn.updated_at,
    };
  }
}
