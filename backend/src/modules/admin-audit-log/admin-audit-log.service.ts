import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities';
import { AuditLogQueryDto, AuditLogExportQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AdminAuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  // ─── Paginated list ────────────────────────────────────────────────────────

  async getAuditLogs(query: AuditLogQueryDto) {
    const { organizationId, userId, action, entityType, startDate, endDate } = query;
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.buildQueryBuilder(
      organizationId,
      userId,
      action,
      entityType,
      startDate,
      endDate,
    );

    const total = await qb.getCount();

    const data = await qb
      .orderBy('log.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Export (all matching rows, no pagination) ─────────────────────────────

  async exportAuditLogs(query: AuditLogExportQueryDto) {
    const { organizationId, userId, action, entityType, startDate, endDate } = query;

    return this.buildQueryBuilder(
      organizationId,
      userId,
      action,
      entityType,
      startDate,
      endDate,
    )
      .orderBy('log.created_at', 'DESC')
      .getMany();
  }

  // ─── Filter options ────────────────────────────────────────────────────────

  async getFilters() {
    const [actionRows, entityTypeRows, orgRows] = await Promise.all([
      this.auditLogRepo
        .createQueryBuilder('log')
        .select('DISTINCT log.action', 'action')
        .where('log.action IS NOT NULL')
        .orderBy('action', 'ASC')
        .getRawMany<{ action: string }>(),

      this.auditLogRepo
        .createQueryBuilder('log')
        .select('DISTINCT log.entity_type', 'entity_type')
        .where('log.entity_type IS NOT NULL')
        .orderBy('entity_type', 'ASC')
        .getRawMany<{ entity_type: string }>(),

      this.auditLogRepo
        .createQueryBuilder('log')
        .select('DISTINCT log.organization_id', 'id')
        .addSelect('org.name', 'name')
        .innerJoin('log.organization', 'org')
        .where('log.organization_id IS NOT NULL')
        .orderBy('name', 'ASC')
        .getRawMany<{ id: string; name: string }>(),
    ]);

    return {
      actions:      actionRows.map((r) => r.action),
      entityTypes:  entityTypeRows.map((r) => r.entity_type),
      organizations: orgRows.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  // ─── Shared query builder ──────────────────────────────────────────────────

  private buildQueryBuilder(
    organizationId?: string,
    userId?: string,
    action?: string,
    entityType?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.auditLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .leftJoinAndSelect('log.organization', 'organization');

    if (organizationId) {
      qb.andWhere('log.organization_id = :organizationId', { organizationId });
    }
    if (userId) {
      qb.andWhere('log.user_id = :userId', { userId });
    }
    if (action) {
      qb.andWhere('log.action ILIKE :action', { action: `%${action}%` });
    }
    if (entityType) {
      qb.andWhere('log.entity_type = :entityType', { entityType });
    }
    if (startDate) {
      qb.andWhere('log.created_at >= :startDate', { startDate: new Date(startDate) });
    }
    if (endDate) {
      // Treat endDate as end-of-day inclusive
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('log.created_at <= :endDate', { endDate: end });
    }

    return qb;
  }
}
