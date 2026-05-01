import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from '../../../database/entities';
import { SecurityEventType } from '../../../common/enums/security-event-types';

export interface SecurityEventInput {
  type: SecurityEventType;
  /**
   * The actor — the user whose action triggered the event. Maps to
   * `audit_logs.user_id`. For login/logout events, actor === target.
   * For admin operations on another user, this is the admin.
   */
  actor_id?: string | null;
  /**
   * The target user the event is *about*. Maps to entity_id (with
   * entity_type='user') so the row can be queried by either side.
   */
  user_id?: string | null;
  organization_id?: string | null;
  /** Free-form metadata. Stored on `new_values`. */
  metadata?: Record<string, unknown>;
  /** Old values for SETTINGS_CHANGED-style diffs. */
  before?: Record<string, unknown>;
  ip_address?: string | null;
  /** Override entity_type if the event isn't user-scoped (e.g. 'security_policy'). */
  entity_type?: string | null;
  /** Override entity_id if the event isn't user-scoped. */
  entity_id?: string | null;
}

/**
 * Writes security-grade events to the existing `audit_logs` table.
 *
 * Two flavours:
 *   - `record(...)` — single-row insert, NOT atomic with caller's work.
 *     Use when the action has already committed and you just want a log.
 *   - `recordAtomic(input, action)` — wraps `action(em)` in a TypeORM
 *     transaction and inserts the audit log inside the same transaction.
 *     If either step throws, both roll back. Use this for security-grade
 *     actions where the audit trail MUST exist atomically with the work.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger(SecurityEventService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Fire-and-forget single-row insert. Errors are logged but not thrown. */
  async record(input: SecurityEventInput): Promise<void> {
    try {
      await this.dataSource
        .getRepository(AuditLog)
        .insert(this.toRow(input) as any);
    } catch (err) {
      this.logger.error(
        `Failed to write security event ${input.type}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Wraps `work(em)` in a transaction and atomically writes the audit
   * log inside it. The work's return value is returned to the caller.
   * If anything throws — including the audit write — the whole txn rolls
   * back.
   */
  async recordAtomic<T>(
    input: SecurityEventInput,
    work: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (em) => {
      const result = await work(em);
      await em.getRepository(AuditLog).insert(this.toRow(input) as any);
      return result;
    });
  }

  private toRow(input: SecurityEventInput): Partial<AuditLog> {
    // Default convention:
    //   audit_logs.user_id      = actor (who did it)
    //   audit_logs.entity_type  = 'user'
    //   audit_logs.entity_id    = target user id
    // Caller can override entity_type/entity_id for non-user-scoped events.
    const isUserScoped =
      !input.entity_type || input.entity_type === 'user';
    return {
      action: input.type,
      user_id: (input.actor_id ?? input.user_id ?? undefined) as any,
      organization_id: (input.organization_id ?? undefined) as any,
      entity_type: input.entity_type ?? (input.user_id ? 'user' : 'security'),
      entity_id: (isUserScoped
        ? input.user_id ?? undefined
        : input.entity_id ?? undefined) as any,
      old_values: input.before ?? (undefined as any),
      new_values: input.metadata ?? (undefined as any),
      ip_address: (input.ip_address ?? undefined) as any,
    };
  }
}
