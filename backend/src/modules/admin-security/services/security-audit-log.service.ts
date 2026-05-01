import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, User } from '../../../database/entities';

export interface SecurityAuditFilter {
  /** Filter by the user the event was about (audit_logs.entity_id where entity_type='user'). */
  target_user_id?: string;
  /** Filter by exact action, e.g. 'security.login.failed'. */
  action?: string;
  /** Substring search across action / ip / metadata. */
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface SecurityAuditRow {
  id: string;
  action: string;
  ip_address: string | null;
  /** The admin/system user who triggered the event (audit.user_id). */
  actor: { id: string; email: string } | null;
  /** The user the event affected (audit.entity_id where entity_type='user'). */
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface SecurityAuditPage {
  rows: SecurityAuditRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Read-side feed over audit_logs filtered to security.* events.
 * Powers the Security Audit Log dashboard at /admin/security/audit.
 */
@Injectable()
export class SecurityAuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async list(filter: SecurityAuditFilter): Promise<SecurityAuditPage> {
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const qb = this.auditRepo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.user_id')
      .addSelect(['u.id', 'u.email'])
      .where("a.action LIKE 'security.%'")
      .orderBy('a.created_at', 'DESC')
      .skip(offset)
      .take(limit);

    if (filter.target_user_id) {
      qb.andWhere(
        "a.entity_type = 'user' AND a.entity_id = :targetId",
        { targetId: filter.target_user_id },
      );
    }
    if (filter.action) {
      qb.andWhere('a.action = :action', { action: filter.action });
    }
    if (filter.search) {
      qb.andWhere(
        '(a.action ILIKE :search OR a.ip_address ILIKE :search)',
        { search: `%${filter.search}%` },
      );
    }
    if (filter.from && filter.to) {
      qb.andWhere('a.created_at BETWEEN :from AND :to', {
        from: filter.from,
        to: filter.to,
      });
    } else if (filter.from) {
      qb.andWhere('a.created_at >= :from', { from: filter.from });
    } else if (filter.to) {
      qb.andWhere('a.created_at <= :to', { to: filter.to });
    }

    const [raw, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);

    const rows: SecurityAuditRow[] = raw.entities.map((e, i) => {
      const r = raw.raw[i];
      return {
        id: e.id,
        action: e.action,
        ip_address: e.ip_address,
        actor: r?.u_id ? { id: r.u_id, email: r.u_email } : null,
        target_user_id:
          e.entity_type === 'user' ? (e.entity_id as string | null) : null,
        metadata: (e.new_values as Record<string, unknown>) ?? null,
        created_at: e.created_at,
      };
    });

    return { rows, total, limit, offset };
  }
}
