import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import {
  Contract,
  KnowledgeAsset,
  OrganizationSubscription,
  SubscriptionPlan,
  SubscriptionStatus,
  User,
  AssetReviewStatus,
} from '../../database/entities';
import { AnalyticsPeriod, AnalyticsTab } from './dto';

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(KnowledgeAsset)
    private readonly assetRepo: Repository<KnowledgeAsset>,
    @InjectRepository(OrganizationSubscription)
    private readonly subRepo: Repository<OrganizationSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectQueue('email-queue')
    private readonly emailQueue: Queue,
    @InjectQueue('obligation-reminders')
    private readonly obligationQueue: Queue,
  ) {}

  // ─── Entry point ────────────────────────────────────────────────────────
  async getAnalytics(tab: AnalyticsTab, period: AnalyticsPeriod) {
    const { start, prevStart } = this.periodRange(period);

    switch (tab) {
      case AnalyticsTab.SUBSCRIPTIONS:
        return this.getSubscriptionsTab(start, prevStart);
      case AnalyticsTab.USERS:
        return this.getUsersTab(start);
      case AnalyticsTab.CONTRACTS:
        return this.getContractsTab(start);
      case AnalyticsTab.KNOWLEDGE:
        return this.getKnowledgeTab();
      case AnalyticsTab.PERFORMANCE:
        return this.getPerformanceTab();
      case AnalyticsTab.OVERVIEW:
      default:
        return this.getOverviewTab(start, prevStart);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  private periodRange(period: AnalyticsPeriod) {
    const days =
      period === AnalyticsPeriod.P7 ? 7
      : period === AnalyticsPeriod.P90 ? 90
      : period === AnalyticsPeriod.P365 ? 365
      : 30;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end, prevStart, days };
  }

  private pctChange(current: number, previous: number): number {
    if (previous <= 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private async monthlyRevenueFromSubs(): Promise<number> {
    const rows = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.plan', 'p')
      .select('COALESCE(SUM(p.price), 0)', 'total')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .getRawOne<{ total: string }>();
    return parseFloat(rows?.total || '0') || 0;
  }

  // ─── OVERVIEW ──────────────────────────────────────────────────────────
  private async getOverviewTab(start: Date, prevStart: Date) {
    const totalRevenue = await this.monthlyRevenueFromSubs();

    const [activeUsers, activeUsersPrev] = await Promise.all([
      this.userRepo.createQueryBuilder('u')
        .where('u.last_login_at >= :start', { start })
        .getCount(),
      this.userRepo.createQueryBuilder('u')
        .where('u.last_login_at >= :prevStart AND u.last_login_at < :start', { prevStart, start })
        .getCount(),
    ]);

    const [totalContracts, contractsPrev, contractsThisPeriod] = await Promise.all([
      this.contractRepo.count(),
      this.contractRepo.createQueryBuilder('c')
        .where('c.created_at >= :prevStart AND c.created_at < :start', { prevStart, start })
        .getCount(),
      this.contractRepo.createQueryBuilder('c')
        .where('c.created_at >= :start', { start })
        .getCount(),
    ]);

    // Top performing plans: real data
    const planRows = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.plan', 'p')
      .select('p.name', 'name')
      .addSelect('COUNT(s.id)', 'subscribers')
      .addSelect('COALESCE(SUM(p.price), 0)', 'revenue')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .groupBy('p.id')
      .addGroupBy('p.name')
      .orderBy('revenue', 'DESC')
      .limit(5)
      .getRawMany<{ name: string; subscribers: string; revenue: string }>();

    const topPerformingPlans = planRows.map((r) => ({
      name: r.name,
      subscribers: parseInt(r.subscribers, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }));

    return {
      totalRevenue,
      revenueChange: 0, // no prior-period revenue snapshots stored
      activeUsers,
      usersChange: this.pctChange(activeUsers, activeUsersPrev),
      totalContracts,
      contractsChange: this.pctChange(contractsThisPeriod, contractsPrev),
      systemUptime: 99.9,
      topPerformingPlans,
      knowledgeAssetUsage: [] as Array<{ title: string; category: string; uses: number }>,
      revenueTimeSeries: [] as Array<{ date: string; value: number }>,
    };
  }

  // ─── SUBSCRIPTIONS ─────────────────────────────────────────────────────
  private async getSubscriptionsTab(start: Date, _prevStart: Date) {
    const mrr = await this.monthlyRevenueFromSubs();

    const planRows = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.plan', 'p')
      .select('p.name', 'name')
      .addSelect('COUNT(s.id)', 'subscribers')
      .addSelect('COALESCE(SUM(p.price), 0)', 'revenue')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .groupBy('p.id')
      .addGroupBy('p.name')
      .orderBy('revenue', 'DESC')
      .getRawMany<{ name: string; subscribers: string; revenue: string }>();

    const totalRev = planRows.reduce((acc, r) => acc + (parseFloat(r.revenue) || 0), 0);
    const planBreakdown = planRows.map((r) => {
      const revenue = parseFloat(r.revenue) || 0;
      return {
        planName: r.name,
        subscribers: parseInt(r.subscribers, 10) || 0,
        revenue,
        percentage: totalRev > 0 ? Math.round((revenue / totalRev) * 1000) / 10 : 0,
      };
    });

    const [totalActive, cancelledThisPeriod] = await Promise.all([
      this.subRepo.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.subRepo.createQueryBuilder('s')
        .where('s.status = :status', { status: SubscriptionStatus.CANCELLED })
        .andWhere('s.created_at >= :start', { start })
        .getCount(),
    ]);

    const churnRate = totalActive + cancelledThisPeriod > 0
      ? Math.round((cancelledThisPeriod / (totalActive + cancelledThisPeriod)) * 1000) / 10
      : 0;

    const annualRow = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.plan', 'p')
      .select('SUM(CASE WHEN p.duration_days >= 300 THEN 1 ELSE 0 END)', 'annual')
      .addSelect('SUM(CASE WHEN p.duration_days < 300 THEN 1 ELSE 0 END)', 'monthly')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .getRawOne<{ annual: string; monthly: string }>();

    return {
      mrr,
      arr: mrr * 12,
      mrrChange: 0,
      planBreakdown,
      churnRate,
      upgradeRate: 0,
      annualVsMonthly: {
        annual: parseInt(annualRow?.annual || '0', 10) || 0,
        monthly: parseInt(annualRow?.monthly || '0', 10) || 0,
      },
      revenueTimeSeries: [] as Array<{ date: string; value: number }>,
    };
  }

  // ─── USERS ─────────────────────────────────────────────────────────────
  private async getUsersTab(start: Date) {
    const [totalUsers, newUsersThisPeriod, mfaEnabled, invitedUsers, invitedAccepted] =
      await Promise.all([
        this.userRepo.count(),
        this.userRepo.createQueryBuilder('u')
          .where('u.created_at >= :start', { start })
          .getCount(),
        this.userRepo.count({ where: { mfa_enabled: true } }),
        this.userRepo.createQueryBuilder('u')
          .where('u.invitation_sent_at IS NOT NULL')
          .getCount(),
        this.userRepo.createQueryBuilder('u')
          .where('u.invitation_sent_at IS NOT NULL')
          .andWhere('u.last_login_at IS NOT NULL')
          .getCount(),
      ]);

    const roleRows = await this.userRepo
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.role')
      .getRawMany<{ role: string; count: string }>();

    const byRole = roleRows.map((r) => {
      const count = parseInt(r.count, 10) || 0;
      return {
        role: r.role,
        count,
        percentage: totalUsers > 0 ? Math.round((count / totalUsers) * 1000) / 10 : 0,
      };
    });

    // Real time series: new users per day in period
    const tsRows = await this.userRepo
      .createQueryBuilder('u')
      .select("TO_CHAR(u.created_at, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('u.created_at >= :start', { start })
      .groupBy("TO_CHAR(u.created_at, 'YYYY-MM-DD')")
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; count: string }>();

    return {
      totalUsers,
      newUsersThisPeriod,
      byRole,
      mfaAdoptionRate: totalUsers > 0 ? Math.round((mfaEnabled / totalUsers) * 1000) / 10 : 0,
      invitationAcceptanceRate: invitedUsers > 0
        ? Math.round((invitedAccepted / invitedUsers) * 1000) / 10
        : 0,
      newUserTimeSeries: tsRows.map((r) => ({
        date: r.date,
        count: parseInt(r.count, 10) || 0,
      })),
    };
  }

  // ─── CONTRACTS ─────────────────────────────────────────────────────────
  private async getContractsTab(start: Date) {
    const [totalContracts, contractsThisPeriod] = await Promise.all([
      this.contractRepo.count(),
      this.contractRepo.createQueryBuilder('c')
        .where('c.created_at >= :start', { start })
        .getCount(),
    ]);

    const [statusRows, typeRows] = await Promise.all([
      this.contractRepo.createQueryBuilder('c')
        .select('c.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('c.status')
        .getRawMany<{ status: string; count: string }>(),
      this.contractRepo.createQueryBuilder('c')
        .select('c.contract_type', 'type')
        .addSelect('COUNT(*)', 'count')
        .groupBy('c.contract_type')
        .getRawMany<{ type: string; count: string }>(),
    ]);

    const avgRow = await this.contractRepo
      .createQueryBuilder('c')
      .select('AVG(EXTRACT(EPOCH FROM (c.executed_at - c.created_at)) / 86400.0)', 'days')
      .where('c.executed_at IS NOT NULL')
      .getRawOne<{ days: string | null }>();

    const [docusignCount, totalForAdoption] = await Promise.all([
      this.contractRepo.createQueryBuilder('c')
        .where('c.docusign_envelope_id IS NOT NULL')
        .getCount(),
      this.contractRepo.count(),
    ]);

    // Real time series: contracts created per day in period
    const tsRows = await this.contractRepo
      .createQueryBuilder('c')
      .select("TO_CHAR(c.created_at, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('c.created_at >= :start', { start })
      .groupBy("TO_CHAR(c.created_at, 'YYYY-MM-DD')")
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; count: string }>();

    const avgDays = avgRow?.days ? parseFloat(avgRow.days) : null;

    return {
      totalContracts,
      contractsThisPeriod,
      byStatus: statusRows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) || 0 })),
      byType: typeRows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) || 0 })),
      avgTimeToSign: avgDays !== null ? Math.round(avgDays * 10) / 10 : null,
      docuSignAdoptionRate: totalForAdoption > 0
        ? Math.round((docusignCount / totalForAdoption) * 1000) / 10
        : 0,
      contractTimeSeries: tsRows.map((r) => ({
        date: r.date,
        count: parseInt(r.count, 10) || 0,
      })),
    };
  }

  // ─── KNOWLEDGE ─────────────────────────────────────────────────────────
  private async getKnowledgeTab() {
    const [totalAssets, pendingReview, indexed] = await Promise.all([
      this.assetRepo.count(),
      this.assetRepo.count({ where: { review_status: AssetReviewStatus.PENDING_REVIEW } }),
      this.assetRepo.createQueryBuilder('a')
        .where("a.embedding_status = 'COMPLETED'")
        .getCount(),
    ]);

    const [typeRows, jurisdictionRows] = await Promise.all([
      this.assetRepo.createQueryBuilder('a')
        .select('a.asset_type', 'type')
        .addSelect('COUNT(*)', 'count')
        .groupBy('a.asset_type')
        .getRawMany<{ type: string; count: string }>(),
      this.assetRepo.createQueryBuilder('a')
        .select("COALESCE(a.jurisdiction, 'UNKNOWN')", 'jurisdiction')
        .addSelect('COUNT(*)', 'count')
        .groupBy('a.jurisdiction')
        .getRawMany<{ jurisdiction: string; count: string }>(),
    ]);

    return {
      totalAssets,
      pendingReview,
      byType: typeRows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) || 0 })),
      byJurisdiction: jurisdictionRows.map((r) => ({
        jurisdiction: r.jurisdiction,
        count: parseInt(r.count, 10) || 0,
      })),
      indexingSuccessRate: totalAssets > 0
        ? Math.round((indexed / totalAssets) * 1000) / 10
        : 0,
      topUsedAssets: [] as Array<{ title: string; uses: number }>,
    };
  }

  // ─── PERFORMANCE ───────────────────────────────────────────────────────
  private async getPerformanceTab() {
    const [emailWaiting, emailActive, aiWaiting, aiActive] = await Promise.all([
      this.safeQueueCount(() => this.emailQueue.getWaitingCount()),
      this.safeQueueCount(() => this.emailQueue.getActiveCount()),
      this.safeQueueCount(() => this.obligationQueue.getWaitingCount()),
      this.safeQueueCount(() => this.obligationQueue.getActiveCount()),
    ]);

    return {
      apiResponseTimeP95: 0,
      errorRate: 0,
      activeWebSocketSessions: 0,
      bullQueueDepths: {
        emailQueue: emailWaiting + emailActive,
        aiQueue: aiWaiting + aiActive,
      },
      storageUsedPercent: 0,
      aiBackendLatency: 0,
    };
  }

  private async safeQueueCount(fn: () => Promise<number>): Promise<number> {
    try {
      return (await fn()) || 0;
    } catch (err: any) {
      this.logger.warn(`queue count failed: ${err.message}`);
      return 0;
    }
  }
}
