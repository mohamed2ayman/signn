import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { AuditLog, User } from '../../../database/entities';

export interface AdminActivityFilter {
  /** Filter by the actor (admin) who performed the action. */
  actor_id?: string;
  /** Filter by exact action string, e.g. 'security.mfa.reset'. */
  action?: string;
  /** Filter by entity type, e.g. 'user', 'security_policy'. */
  entity_type?: string;
  /** Substring match against action OR entity_type (case-insensitive). */
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AdminActivityRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  actor: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface AdminActivityPage {
  rows: AdminActivityRow[];
  total: number;
  limit: number;
  offset: number;
}

const ADMIN_ACTION_PREFIXES = [
  'security.',
  'admin.',
  'plan.',
  'user.',
  'org.',
  'subscription.',
];

/**
 * Read-side query layer over `audit_logs` for the Admin Activity feed
 * — returns only rows whose action begins with an admin-relevant
 * prefix (security.*, admin.*, plan.*, etc.) so it doesn't get noisy
 * with everyday user CRUD.
 */
@Injectable()
export class AdminActivityLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async list(filter: AdminActivityFilter): Promise<AdminActivityPage> {
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const qb = this.auditRepo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.user_id')
      .addSelect([
        'u.id',
        'u.email',
        'u.first_name',
        'u.last_name',
      ])
      .orderBy('a.created_at', 'DESC')
      .skip(offset)
      .take(limit);

    // Restrict to admin-relevant prefixes
    qb.where(
      ADMIN_ACTION_PREFIXES.map((_, i) => `a.action LIKE :p${i}`).join(' OR '),
      Object.fromEntries(ADMIN_ACTION_PREFIXES.map((p, i) => [`p${i}`, `${p}%`])),
    );

    if (filter.actor_id) {
      qb.andWhere('a.user_id = :actorId', { actorId: filter.actor_id });
    }
    if (filter.action) {
      qb.andWhere('a.action = :action', { action: filter.action });
    }
    if (filter.entity_type) {
      qb.andWhere('a.entity_type = :entityType', {
        entityType: filter.entity_type,
      });
    }
    if (filter.search) {
      qb.andWhere(
        '(a.action ILIKE :search OR a.entity_type ILIKE :search)',
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

    const rows: AdminActivityRow[] = raw.entities.map((e, i) => {
      const r = raw.raw[i];
      return {
        id: e.id,
        action: e.action,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        ip_address: e.ip_address,
        actor: r?.u_id
          ? {
              id: r.u_id,
              email: r.u_email,
              first_name: r.u_first_name,
              last_name: r.u_last_name,
            }
          : null,
        metadata: (e.new_values as Record<string, unknown>) ?? null,
        created_at: e.created_at,
      };
    });

    return { rows, total, limit, offset };
  }

  /** Distinct list of action strings that have been used — for filter dropdown. */
  async listKnownActions(): Promise<string[]> {
    const rows = await this.auditRepo
      .createQueryBuilder('a')
      .select('DISTINCT a.action', 'action')
      .where(
        ADMIN_ACTION_PREFIXES.map((_, i) => `a.action LIKE :p${i}`).join(' OR '),
        Object.fromEntries(
          ADMIN_ACTION_PREFIXES.map((p, i) => [`p${i}`, `${p}%`]),
        ),
      )
      .orderBy('a.action', 'ASC')
      .getRawMany<{ action: string }>();
    return rows.map((r) => r.action);
  }
}
