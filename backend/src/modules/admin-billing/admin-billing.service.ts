import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Brackets, Repository } from 'typeorm';
import {
  OrganizationSubscription,
  SubscriptionStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  UserRole,
  User,
} from '../../database/entities';
import { TransactionsQueryDto } from './dto';

interface PlanRevenueRow {
  planName: string;
  revenue: number;
  subscribers: number;
}

interface CurrencyRevenueRow {
  currency: string;
  amount: number;
}

interface TransactionJoinRow {
  t_id: string;
  t_organization_id: string;
  t_paymob_transaction_id: string | null;
  t_amount: string;
  t_currency: string;
  t_status: string;
  t_plan_id: string | null;
  t_plan_name: string | null;
  t_created_at: Date;
  o_name: string | null;
}

@Injectable()
export class AdminBillingService {
  constructor(
    @InjectRepository(OrganizationSubscription)
    private readonly subRepo: Repository<OrganizationSubscription>,
    @InjectRepository(PaymentTransaction)
    private readonly txRepo: Repository<PaymentTransaction>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── SUMMARY ─────────────────────────────────────────────────────────
  async getSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // All active subscriptions with joined plan — used for MRR, ARR,
    // activeSubscriptions count, revenueByPlan, revenueByCurrency.
    const activeSubs = await this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .getMany();

    const activeSubscriptions = activeSubs.length;

    // Normalize each active sub into a monthly value.
    // Treat plan.duration_days as the billing period; MRR = price / duration_days * 30.
    let mrr = 0;
    const planAgg = new Map<string, PlanRevenueRow>();
    const currencyAgg = new Map<string, CurrencyRevenueRow>();

    for (const sub of activeSubs) {
      const plan = sub.plan;
      if (!plan) continue;
      const price = Number(plan.price) || 0;
      const durationDays = Number(plan.duration_days) || 30;
      const monthlyValue = durationDays > 0 ? (price / durationDays) * 30 : 0;
      mrr += monthlyValue;

      const planKey = plan.id;
      const planRow = planAgg.get(planKey);
      if (planRow) {
        planRow.revenue += monthlyValue;
        planRow.subscribers += 1;
      } else {
        planAgg.set(planKey, {
          planName: plan.name,
          revenue: monthlyValue,
          subscribers: 1,
        });
      }

      const currencyKey = (plan.currency || 'USD').toUpperCase();
      const curRow = currencyAgg.get(currencyKey);
      if (curRow) {
        curRow.amount += monthlyValue;
      } else {
        currencyAgg.set(currencyKey, {
          currency: currencyKey,
          amount: monthlyValue,
        });
      }
    }

    const arr = mrr * 12;

    // MRR change vs last month — based on active subscriptions that
    // existed at end of last month. A sub is counted in a month if its
    // start_date <= end of month AND (end_date >= end of month OR end_date null)
    // AND status was ACTIVE at the time. We approximate using start_date
    // since we don't track status history.
    const lastMonthSubs = await this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .where('s.start_date <= :eom', { eom: endOfLastMonth })
      .andWhere(
        new Brackets((qb) => {
          qb.where('s.end_date >= :eom2', { eom2: endOfLastMonth })
            .orWhere('s.end_date IS NULL');
        }),
      )
      .getMany();

    let lastMonthMrr = 0;
    for (const sub of lastMonthSubs) {
      const plan = sub.plan;
      if (!plan) continue;
      const price = Number(plan.price) || 0;
      const durationDays = Number(plan.duration_days) || 30;
      lastMonthMrr += durationDays > 0 ? (price / durationDays) * 30 : 0;
    }

    const mrrChange =
      lastMonthMrr > 0
        ? ((mrr - lastMonthMrr) / lastMonthMrr) * 100
        : mrr > 0
          ? 100
          : 0;

    // Failed payments in last 30 days
    const failedTxns = await this.txRepo.find({
      where: {
        status: PaymentTransactionStatus.FAILED,
        created_at: Between(thirtyDaysAgo, now),
      },
    });
    const failedPaymentsCount = failedTxns.length;
    const failedPaymentsAmount = failedTxns.reduce(
      (acc, t) => acc + Number(t.amount),
      0,
    );

    // New / churned this month — based on subscription.created_at and
    // whether subscription ended in current month.
    const newThisMonth = await this.subRepo
      .createQueryBuilder('s')
      .where('s.created_at >= :som', { som: startOfMonth })
      .getCount();

    const churnedThisMonth = await this.subRepo
      .createQueryBuilder('s')
      .where('s.end_date >= :som AND s.end_date <= :now', { som: startOfMonth, now })
      .andWhere('s.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED, SubscriptionStatus.INACTIVE],
      })
      .getCount();

    const revenueByPlan = Array.from(planAgg.values())
      .map((r) => ({ ...r, revenue: round2(r.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);

    const revenueByCurrency = Array.from(currencyAgg.values())
      .map((r) => ({ ...r, amount: round2(r.amount) }))
      .sort((a, b) => b.amount - a.amount);

    return {
      mrr: round2(mrr),
      arr: round2(arr),
      mrrChange: round2(mrrChange),
      activeSubscriptions,
      failedPaymentsCount,
      failedPaymentsAmount: round2(failedPaymentsAmount),
      newThisMonth,
      churnedThisMonth,
      revenueByPlan,
      revenueByCurrency,
    };
  }

  // ─── TRANSACTIONS LIST ──────────────────────────────────────────────
  async getTransactions(query: TransactionsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const [rawRows, total] = await Promise.all([
      this.buildTransactionsQuery(query)
        .orderBy('t.created_at', 'DESC')
        .offset(offset)
        .limit(limit)
        .getRawMany<TransactionJoinRow>(),
      this.buildTransactionsCountQuery(query).getCount(),
    ]);

    return {
      data: rawRows.map(this.mapTransactionRow),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ─── FAILED PAYMENTS (last 30 days) ─────────────────────────────────
  async getFailedPayments() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Group by organization, get count + sum + last attempt
    const rows = await this.txRepo
      .createQueryBuilder('t')
      .leftJoin('organizations', 'o', 'o.id = t.organization_id')
      .select('t.organization_id', 'organization_id')
      .addSelect('o.name', 'organization_name')
      .addSelect('COUNT(*)::int', 'failure_count')
      .addSelect('SUM(t.amount)::float', 'failed_amount')
      .addSelect('MAX(t.currency)', 'currency')
      .addSelect('MAX(t.created_at)', 'last_attempt')
      .where('t.status = :status', { status: PaymentTransactionStatus.FAILED })
      .andWhere('t.created_at >= :since', { since: thirtyDaysAgo })
      .groupBy('t.organization_id')
      .addGroupBy('o.name')
      .orderBy('MAX(t.created_at)', 'DESC')
      .getRawMany<{
        organization_id: string;
        organization_name: string | null;
        failure_count: number;
        failed_amount: number;
        currency: string;
        last_attempt: Date;
      }>();

    if (rows.length === 0) return [];

    // Fetch the first OWNER_ADMIN per org for contactEmail
    const orgIds = rows.map((r) => r.organization_id);
    const owners = await this.userRepo
      .createQueryBuilder('u')
      .where('u.organization_id IN (:...orgIds)', { orgIds })
      .andWhere('u.role = :role', { role: UserRole.OWNER_ADMIN })
      .andWhere('u.is_active = TRUE')
      .orderBy('u.created_at', 'ASC')
      .getMany();

    const ownerByOrg = new Map<string, string>();
    for (const u of owners) {
      if (!ownerByOrg.has(u.organization_id)) {
        ownerByOrg.set(u.organization_id, u.email);
      }
    }

    return rows.map((r) => ({
      organizationId: r.organization_id,
      organizationName: r.organization_name ?? 'Unknown',
      contactEmail: ownerByOrg.get(r.organization_id) ?? null,
      failedAmount: round2(Number(r.failed_amount) || 0),
      currency: r.currency,
      lastAttempt: r.last_attempt,
      failureCount: Number(r.failure_count) || 0,
    }));
  }

  // ─── EXPORT (no pagination cap; hard cap 50k safety) ────────────────
  async exportTransactions(query: TransactionsQueryDto) {
    const rows = await this.buildTransactionsQuery(query)
      .orderBy('t.created_at', 'DESC')
      .limit(50_000)
      .getRawMany<TransactionJoinRow>();

    return rows.map(this.mapTransactionRow);
  }

  // ─── internals ──────────────────────────────────────────────────────
  private buildTransactionsQuery(query: TransactionsQueryDto) {
    const qb = this.txRepo
      .createQueryBuilder('t')
      .leftJoin('organizations', 'o', 'o.id = t.organization_id')
      .select('t.id', 't_id')
      .addSelect('t.organization_id', 't_organization_id')
      .addSelect('t.paymob_transaction_id', 't_paymob_transaction_id')
      .addSelect('t.amount', 't_amount')
      .addSelect('t.currency', 't_currency')
      .addSelect('t.status', 't_status')
      .addSelect('t.plan_id', 't_plan_id')
      .addSelect('t.plan_name', 't_plan_name')
      .addSelect('t.created_at', 't_created_at')
      .addSelect('o.name', 'o_name');

    this.applyTransactionFilters(qb, query);
    return qb;
  }

  private buildTransactionsCountQuery(query: TransactionsQueryDto) {
    const qb = this.txRepo.createQueryBuilder('t');
    this.applyTransactionFilters(qb, query);
    return qb;
  }

  private applyTransactionFilters(
    qb: ReturnType<Repository<PaymentTransaction>['createQueryBuilder']>,
    query: TransactionsQueryDto,
  ) {
    if (query.organizationId) {
      qb.andWhere('t.organization_id = :org', { org: query.organizationId });
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status.toUpperCase() });
    }
    if (query.currency) {
      qb.andWhere('UPPER(t.currency) = :cur', {
        cur: query.currency.toUpperCase(),
      });
    }
    if (query.startDate) {
      qb.andWhere('t.created_at >= :sd', { sd: new Date(query.startDate) });
    }
    if (query.endDate) {
      const d = new Date(query.endDate);
      d.setHours(23, 59, 59, 999);
      qb.andWhere('t.created_at <= :ed', { ed: d });
    }
    return qb;
  }

  private mapTransactionRow = (r: TransactionJoinRow) => ({
    id: r.t_id,
    organization_id: r.t_organization_id,
    organizationName: r.o_name ?? 'Unknown',
    paymob_transaction_id: r.t_paymob_transaction_id,
    amount: Number(r.t_amount),
    currency: r.t_currency,
    status: r.t_status,
    plan_id: r.t_plan_id,
    plan_name: r.t_plan_name,
    created_at: r.t_created_at,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
