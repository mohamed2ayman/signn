import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Organization,
  OrganizationSubscription,
  SubscriptionStatus,
  User,
  Project,
  Contract,
  AuditLog,
} from '../../database/entities';
import {
  ListOrganizationsQueryDto,
  OrgStatusFilter,
} from './dto';

interface OrgRow {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  crn: string | null;
  logo_url: string | null;
  created_at: Date;
  is_suspended: boolean;
  suspension_reason: string | null;
  active_user_count: string;
  project_count: string;
  contract_count: string;
  plan_id: string | null;
  plan_name: string | null;
  plan_status: string | null;
  plan_end_date: Date | null;
}

@Injectable()
export class AdminOrganizationsService {
  private readonly logger = new Logger(AdminOrganizationsService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(OrganizationSubscription)
    private readonly subRepo: Repository<OrganizationSubscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  // ─── LIST ────────────────────────────────────────────────────────────
  async list(query: ListOrganizationsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const qb = this.orgRepo
      .createQueryBuilder('o')
      .leftJoin(
        (sub) =>
          sub
            .select('su.organization_id', 'organization_id')
            .addSelect('su.plan_id', 'plan_id')
            .addSelect('su.status', 'status')
            .addSelect('su.end_date', 'end_date')
            .addSelect(
              'ROW_NUMBER() OVER (PARTITION BY su.organization_id ORDER BY CASE WHEN su.status = \'ACTIVE\' THEN 0 ELSE 1 END, su.start_date DESC)',
              'rn',
            )
            .from(OrganizationSubscription, 'su'),
        'latest_sub',
        '"latest_sub"."organization_id" = o.id AND "latest_sub"."rn" = 1',
      )
      .leftJoin('subscription_plans', 'p', 'p.id = "latest_sub"."plan_id"')
      .select('o.id', 'id')
      .addSelect('o.name', 'name')
      .addSelect('o.industry', 'industry')
      .addSelect('o.country', 'country')
      .addSelect('o.crn', 'crn')
      .addSelect('o.logo_url', 'logo_url')
      .addSelect('o.created_at', 'created_at')
      .addSelect('o.is_suspended', 'is_suspended')
      .addSelect('o.suspension_reason', 'suspension_reason')
      .addSelect(
        '(SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.id AND u.is_active = TRUE)',
        'active_user_count',
      )
      .addSelect(
        '(SELECT COUNT(*)::int FROM projects pr WHERE pr.organization_id = o.id)',
        'project_count',
      )
      .addSelect(
        '(SELECT COUNT(*)::int FROM contracts c INNER JOIN projects pr ON pr.id = c.project_id WHERE pr.organization_id = o.id)',
        'contract_count',
      )
      .addSelect('p.id', 'plan_id')
      .addSelect('p.name', 'plan_name')
      .addSelect('"latest_sub"."status"', 'plan_status')
      .addSelect('"latest_sub"."end_date"', 'plan_end_date');

    if (query.search) {
      qb.andWhere('(o.name ILIKE :s OR o.crn ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    if (query.country) qb.andWhere('o.country = :country', { country: query.country });
    if (query.industry) qb.andWhere('o.industry = :industry', { industry: query.industry });
    if (query.planId) qb.andWhere('"latest_sub"."plan_id" = :pid', { pid: query.planId });
    if (query.status === OrgStatusFilter.ACTIVE) {
      qb.andWhere('o.is_suspended = FALSE');
    } else if (query.status === OrgStatusFilter.SUSPENDED) {
      qb.andWhere('o.is_suspended = TRUE');
    }

    qb.orderBy('o.created_at', 'DESC').offset(offset).limit(limit);

    const [rows, total] = await Promise.all([
      qb.getRawMany<OrgRow>(),
      this.countOrganizations(query),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        industry: r.industry,
        country: r.country,
        crn: r.crn,
        logo_url: r.logo_url,
        created_at: r.created_at,
        activeUserCount: parseInt(r.active_user_count as unknown as string, 10) || 0,
        projectCount: parseInt(r.project_count as unknown as string, 10) || 0,
        contractCount: parseInt(r.contract_count as unknown as string, 10) || 0,
        currentPlan: r.plan_id
          ? {
              id: r.plan_id,
              name: r.plan_name || '',
              status: r.plan_status || '',
              expiresAt: r.plan_end_date ? new Date(r.plan_end_date).toISOString() : null,
            }
          : null,
        isSuspended: !!r.is_suspended,
        suspensionReason: r.suspension_reason,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private async countOrganizations(query: ListOrganizationsQueryDto): Promise<number> {
    const qb = this.orgRepo.createQueryBuilder('o');
    if (query.planId) {
      qb.leftJoin(
        (sub) =>
          sub
            .select('su.organization_id', 'organization_id')
            .addSelect('su.plan_id', 'plan_id')
            .addSelect(
              'ROW_NUMBER() OVER (PARTITION BY su.organization_id ORDER BY CASE WHEN su.status = \'ACTIVE\' THEN 0 ELSE 1 END, su.start_date DESC)',
              'rn',
            )
            .from(OrganizationSubscription, 'su'),
        'latest_sub',
        '"latest_sub"."organization_id" = o.id AND "latest_sub"."rn" = 1',
      ).andWhere('"latest_sub"."plan_id" = :pid', { pid: query.planId });
    }
    if (query.search) {
      qb.andWhere('(o.name ILIKE :s OR o.crn ILIKE :s)', { s: `%${query.search}%` });
    }
    if (query.country) qb.andWhere('o.country = :country', { country: query.country });
    if (query.industry) qb.andWhere('o.industry = :industry', { industry: query.industry });
    if (query.status === OrgStatusFilter.ACTIVE) qb.andWhere('o.is_suspended = FALSE');
    if (query.status === OrgStatusFilter.SUSPENDED) qb.andWhere('o.is_suspended = TRUE');
    return qb.getCount();
  }

  // ─── DETAIL ──────────────────────────────────────────────────────────
  async getById(id: string) {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    const [users, history, recentAuditLogs, projectCount] = await Promise.all([
      this.userRepo.find({
        where: { organization_id: id },
        select: [
          'id', 'first_name', 'last_name', 'email', 'role',
          'is_active', 'last_login_at',
        ],
        order: { created_at: 'DESC' },
      }),
      this.subRepo
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.plan', 'p')
        .where('s.organization_id = :id', { id })
        .orderBy('s.start_date', 'DESC')
        .getMany(),
      this.auditRepo.find({
        where: { organization_id: id },
        order: { created_at: 'DESC' },
        take: 5,
        relations: { user: true },
      }),
      this.projectRepo.count({ where: { organization_id: id } }),
    ]);

    const activeSub = history.find(
      (h) => h.status === SubscriptionStatus.ACTIVE,
    );
    const plan = activeSub?.plan;

    const maxUsers = plan?.max_users ?? 0;
    const maxProjects = plan?.max_projects ?? 0;
    const activeUserCount = users.filter((u) => u.is_active).length;

    return {
      id: org.id,
      name: org.name,
      industry: org.industry,
      country: org.country,
      crn: org.crn,
      logo_url: org.logo_url,
      created_at: org.created_at,
      updated_at: org.updated_at,
      isSuspended: !!org.is_suspended,
      suspensionReason: org.suspension_reason,
      suspendedAt: org.suspended_at,
      currentPlan: activeSub
        ? {
            id: activeSub.plan_id,
            name: plan?.name || '',
            status: activeSub.status,
            price: plan ? Number(plan.price) : 0,
            currency: plan?.currency || 'USD',
            startDate: activeSub.start_date,
            expiresAt: activeSub.end_date,
          }
        : null,
      users: users.map((u) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`.trim(),
        email: u.email,
        role: u.role,
        is_active: u.is_active,
        last_login_at: u.last_login_at,
      })),
      subscriptionHistory: history.map((h) => ({
        id: h.id,
        planName: h.plan?.name || '',
        startDate: h.start_date,
        endDate: h.end_date,
        status: h.status,
      })),
      currentUsage: {
        users: { used: activeUserCount, max: maxUsers },
        projects: { used: projectCount, max: maxProjects },
      },
      featureFlagOverrides: org.feature_flag_overrides || {},
      recentAuditLogs: recentAuditLogs.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entity_type,
        user: a.user
          ? `${a.user.first_name} ${a.user.last_name}`.trim()
          : null,
        created_at: a.created_at,
      })),
    };
  }

  // ─── SUSPEND / UNSUSPEND ─────────────────────────────────────────────
  async suspend(id: string, reason: string, actingUserId: string) {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    org.is_suspended = true;
    org.suspension_reason = reason;
    org.suspended_at = new Date();
    await this.orgRepo.save(org);

    await this.writeAuditLog(actingUserId, id, 'ORGANIZATION_SUSPENDED', {
      reason,
    });

    return this.getById(id);
  }

  async unsuspend(id: string, actingUserId: string) {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    org.is_suspended = false;
    org.suspension_reason = null;
    org.suspended_at = null;
    await this.orgRepo.save(org);

    await this.writeAuditLog(actingUserId, id, 'ORGANIZATION_UNSUSPENDED', {});

    return this.getById(id);
  }

  async updateFeatureFlags(
    id: string,
    flags: Record<string, boolean>,
    actingUserId: string,
  ) {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);

    const previous = org.feature_flag_overrides || {};
    org.feature_flag_overrides = flags;
    await this.orgRepo.save(org);

    await this.writeAuditLog(
      actingUserId,
      id,
      'ORGANIZATION_FEATURE_FLAGS_UPDATED',
      { previous, next: flags },
    );

    return this.getById(id);
  }

  private async writeAuditLog(
    userId: string,
    orgId: string,
    action: string,
    newValues: Record<string, unknown>,
  ) {
    try {
      await this.auditRepo.insert({
        user_id: userId,
        organization_id: orgId,
        action,
        entity_type: 'organization',
        entity_id: orgId,
        new_values: newValues as any,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write audit log: ${err.message}`);
    }
  }
}
