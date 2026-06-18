import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ComplianceCheck,
  Contract,
  Obligation,
  ObligationAssignee,
  ObligationStatus,
  ObligationType,
} from '../../../database/entities';
import { ObligationReminderLog } from '../../../database/entities/obligation-reminder-log.entity';
import { ObligationPortfolioFiltersDto } from '../dto/obligation-portfolio-filters.dto';
// Option B — S2c-2: assignUser/unassignUser/updateEvidence load the
// obligation through the scoped-repository tenancy chokepoint (canonical
// obligation→contract→project→org) BEFORE mutating — UNDER the #60
// controller walls. Two checks, two layers.
import { ObligationScopedRepository } from '../../scoped-repository/obligation-scoped.repository';

/** Shape returned by getCalendar(). */
export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  status: ObligationStatus;
  contract_id: string;
  project_id: string | null;
  color: string;
}

/**
 * Layer-4 (obligation extraction) post-processor.
 *
 * Takes the raw output from the obligations extractor agent and bulk-
 * creates Obligation rows linked to the compliance check, with the
 * compliance-aware fields populated (obligation_type, clause_ref,
 * duration, timeframe_description, amount, currency, is_critical,
 * project_id).
 *
 * Phase 7.1 adds: assignUser / unassignUser / updateEvidence /
 * getPortfolio / getCalendar — org-scoped obligation management APIs.
 */
@Injectable()
export class ComplianceObligationService {
  private readonly logger = new Logger(ComplianceObligationService.name);

  /** Obligation types considered critical-path by default. */
  private static readonly CRITICAL_TYPES = new Set<ObligationType>([
    ObligationType.NOTICE_PERIOD,
    ObligationType.PERFORMANCE_BOND,
    ObligationType.MILESTONE,
    ObligationType.DISPUTE_RESOLUTION,
    ObligationType.INSURANCE,
  ]);

  /** Calendar color map keyed by status. */
  private static readonly STATUS_COLOR: Record<ObligationStatus, string> = {
    [ObligationStatus.PENDING]: '#4F6EF7',
    [ObligationStatus.IN_PROGRESS]: '#F59E0B',
    [ObligationStatus.OVERDUE]: '#DC2626',
    [ObligationStatus.COMPLETED]: '#059669',
    [ObligationStatus.MET]: '#059669',
    [ObligationStatus.WAIVED]: '#9CA3AF',
  };

  constructor(
    @InjectRepository(Obligation) // lint-exempt: write (insert in persistFromExtraction / save on the scope-loaded evidence row) + aggregation QBs (Q3 — getPortfolio/getCalendar, org-scoped via contract→project→org)
    private readonly obligationRepo: Repository<Obligation>,
    @InjectRepository(Contract) // lint-exempt: async reconcile path (persistFromExtraction, no request org); contract_id comes from the reconciled check (checkId wall-validated upstream in getOne)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(ObligationAssignee) // lint-exempt: two-step read (parent obligation scope-validated upstream via obligationScoped) + writes; ObligationAssignee is a grandchild — no scoped subclass (S2c plan)
    private readonly assigneeRepo: Repository<ObligationAssignee>,
    @InjectRepository(ObligationReminderLog) // lint-exempt: two-step read (parent obligation scope-validated upstream) ; ObligationReminderLog is a grandchild — no scoped subclass (S2c plan)
    private readonly reminderLogRepo: Repository<ObligationReminderLog>,
    // S2c-2 — data-layer tenancy load before assignee/evidence mutations.
    private readonly obligationScoped: ObligationScopedRepository,
  ) {}

  // ─── Phase 3.4 — Layer-4 obligation extraction ───────────────────────────

  async persistFromExtraction(
    check: ComplianceCheck,
    rawObligations: any[],
  ): Promise<number> {
    if (!Array.isArray(rawObligations) || rawObligations.length === 0) {
      return 0;
    }
    const contract = await this.contractRepo.findOne({ // lint-exempt: async reconcile path (no request org); contract_id from the reconciled check.contract_id (checkId wall-validated upstream in getOne)
      where: { id: check.contract_id },
    });
    if (!contract) {
      this.logger.warn(
        `Contract ${check.contract_id} not found while persisting obligations`,
      );
      return 0;
    }

    const rows = rawObligations.map((raw) => {
      const obligationType = this.coerceType(raw.obligation_type);
      const responsibleParty = this.coerceParty(raw.responsible_party);
      const isCritical =
        Boolean(raw.is_critical) ||
        ComplianceObligationService.CRITICAL_TYPES.has(obligationType);

      return {
        contract_id: contract.id,
        project_id: contract.project_id,
        compliance_check_id: check.id,
        obligation_type: obligationType,
        responsible_party: responsibleParty ?? undefined,
        description: raw.description ?? '',
        clause_ref: raw.clause_ref ?? raw.clause_id ?? null,
        due_date: this.parseDate(raw.due_date ?? raw.deadline),
        duration: raw.duration ?? null,
        timeframe_description: raw.timeframe_description ?? raw.deadline ?? null,
        amount: this.parseAmount(raw.amount),
        currency: raw.currency ?? null,
        is_critical: isCritical,
        frequency: raw.recurrence ?? raw.frequency ?? null,
        status: ObligationStatus.PENDING,
        reminder_days_before: 7,
      };
    });

    if (rows.length === 0) return 0;
    await this.obligationRepo.insert(rows as any); // lint-exempt: write (bulk insert, async reconcile path — persistFromExtraction); the chokepoint is read-only
    return rows.length;
  }

  // ─── Phase 7.1 — Assignee management ─────────────────────────────────────

  /**
   * Assign a user to an obligation.
   * Throws ConflictException (409) if the user is already assigned.
   *
   * S2c-2: the obligation resolves through the scoped chokepoint (layer 2)
   * before the assignee write — previously this method mutated with NO
   * obligation load at all. The #60 controller wall stays above (layer 1).
   */
  async assignUser(
    obligationId: string,
    userId: string,
    assignedBy: string,
    orgId: string,
  ): Promise<ObligationAssignee> {
    // SCOPED LOAD (tenancy) — cross-org → 404, no existence leak.
    await this.obligationScoped.scopedFindByIdOrThrow(obligationId, orgId);
    const existing = await this.assigneeRepo.findOne({ // lint-exempt: two-step read — obligation_id scope-validated by obligationScoped.scopedFindByIdOrThrow on the line above
      where: { obligation_id: obligationId, user_id: userId },
    });
    if (existing) {
      throw new ConflictException(
        'User is already assigned to this obligation',
      );
    }
    const assignee = this.assigneeRepo.create({
      obligation_id: obligationId,
      user_id: userId,
      assigned_by: assignedBy,
    });
    return this.assigneeRepo.save(assignee); // lint-exempt: write (assignee insert, obligation scope-validated upstream); the chokepoint is read-only
  }

  /**
   * Remove a user's assignment from an obligation.
   * Throws NotFoundException (404) if the assignee row does not exist.
   *
   * S2c-2: scoped obligation load before the assignee delete (this method
   * previously mutated with NO obligation load). Wall stays above.
   */
  async unassignUser(
    obligationId: string,
    userId: string,
    orgId: string,
  ): Promise<void> {
    // SCOPED LOAD (tenancy) — cross-org → 404, no existence leak.
    await this.obligationScoped.scopedFindByIdOrThrow(obligationId, orgId);
    const result = await this.assigneeRepo.delete({ // lint-exempt: write (assignee delete, obligation scope-validated upstream); the chokepoint is read-only
      obligation_id: obligationId,
      user_id: userId,
    });
    if (!result.affected || result.affected === 0) {
      throw new NotFoundException('Assignee not found');
    }
  }

  /**
   * Attach a evidence URL to an obligation (e.g. a completion document).
   *
   * S2c-2: the bare findOne is replaced by the scoped by-id load — the save
   * operates on the scoped-loaded row. Wall stays above.
   */
  async updateEvidence(
    obligationId: string,
    evidenceUrl: string,
    orgId: string,
  ): Promise<Obligation> {
    // SCOPED LOAD (tenancy) — cross-org → 404, no existence leak.
    const o = await this.obligationScoped.scopedFindByIdOrThrow(
      obligationId,
      orgId,
    );
    o.evidence_url = evidenceUrl;
    return this.obligationRepo.save(o); // lint-exempt: write (save on the scope-loaded row from obligationScoped.scopedFindByIdOrThrow above); the chokepoint is read-only
  }

  // ─── Phase 7.2-C — Reminder history ──────────────────────────────────────

  /**
   * Return all reminder log entries for a given obligation, most-recent first.
   * Max ~8 rows per obligation (one per tier + weekly digest) — no pagination
   * needed.
   */
  async getReminderLogs(obligationId: string): Promise<ObligationReminderLog[]> {
    return this.reminderLogRepo.find({ // lint-exempt: two-step read — the controller scope-validates the parent obligation (loadObligationInContract → obligationScoped) before calling this; reminder logs keyed by the validated obligation id
      where: { obligation_id: obligationId },
      order: { sent_at: 'DESC' },
    });
  }

  // ─── Phase 7.1 — Portfolio & Calendar queries ─────────────────────────────

  /**
   * Cross-contract obligation portfolio scoped to the caller's organisation.
   * Optional filters: from/to (ISO date), project_id, status, type, assignee UUID.
   */
  async getPortfolio(
    orgId: string,
    filters: ObligationPortfolioFiltersDto,
  ): Promise<Obligation[]> {
    // Resolve the effective date window. Explicit from/to always win; the
    // `within` convenience window is only applied when neither is supplied,
    // so callers that never pass `within` see identical behaviour to before.
    let from = filters.from;
    let to = filters.to;
    if (filters.within != null && !from && !to) {
      const now = new Date();
      const end = new Date(now.getTime() + filters.within * 24 * 60 * 60 * 1000);
      from = now.toISOString().slice(0, 10);
      to = end.toISOString().slice(0, 10);
    }

    const qb = this.obligationRepo // lint-exempt: aggregation QB (Q3 — obligation analytics)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.contract', 'c')
      .leftJoinAndSelect('c.project', 'p')
      .leftJoinAndSelect('o.assignees', 'oa')
      .leftJoinAndSelect('oa.user', 'au')
      .where('p.organization_id = :orgId', { orgId });

    if (filters.project_id) {
      qb.andWhere('p.id = :projectId', { projectId: filters.project_id });
    }
    if (filters.status) {
      qb.andWhere('o.status = :status', { status: filters.status });
    }
    if (filters.type) {
      qb.andWhere('o.obligation_type = :type', { type: filters.type });
    }
    if (filters.assignee) {
      qb.andWhere('oa.user_id = :assignee', { assignee: filters.assignee });
    }
    if (from) {
      qb.andWhere('o.due_date >= :from', { from });
    }
    if (to) {
      qb.andWhere('o.due_date <= :to', { to });
    }

    return qb.orderBy('o.due_date', 'ASC').getMany();
  }

  /**
   * Date-range obligation calendar scoped to the caller's organisation.
   * Returns lightweight calendar-event objects (max 1 year range enforced by caller).
   */
  async getCalendar(
    orgId: string,
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    const obligations = await this.obligationRepo // lint-exempt: aggregation QB (Q3 — obligation analytics)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.contract', 'c')
      .leftJoinAndSelect('c.project', 'p')
      .where('p.organization_id = :orgId', { orgId })
      .andWhere('o.due_date BETWEEN :from AND :to', { from, to })
      .orderBy('o.due_date', 'ASC')
      .getMany();

    return obligations.map((o) => ({
      id: o.id,
      title:
        o.description.length > 80
          ? `${o.description.slice(0, 80)}…`
          : o.description,
      start: o.due_date
        ? new Date(o.due_date).toISOString().split('T')[0]
        : null,
      end: o.due_date
        ? new Date(o.due_date).toISOString().split('T')[0]
        : null,
      status: o.status,
      contract_id: o.contract_id,
      project_id: o.project_id,
      color:
        ComplianceObligationService.STATUS_COLOR[o.status] ?? '#4F6EF7',
    }));
  }

  // ─── Coercion helpers ─────────────────────────────────────────────────────

  private coerceType(raw: unknown): ObligationType {
    if (typeof raw !== 'string') return ObligationType.OTHER;
    const upper = raw.toUpperCase();
    const map: Record<string, ObligationType> = {
      PAYMENT: ObligationType.PAYMENT,
      DELIVERY: ObligationType.MILESTONE,
      MILESTONE: ObligationType.MILESTONE,
      REPORTING: ObligationType.REPORTING,
      COMPLIANCE: ObligationType.OTHER,
      NOTICE: ObligationType.NOTICE_PERIOD,
      NOTICE_PERIOD: ObligationType.NOTICE_PERIOD,
      INSURANCE: ObligationType.INSURANCE,
      BOND: ObligationType.PERFORMANCE_BOND,
      PERFORMANCE_BOND: ObligationType.PERFORMANCE_BOND,
      DEFECTS: ObligationType.DEFECTS_LIABILITY,
      DEFECTS_LIABILITY: ObligationType.DEFECTS_LIABILITY,
      DISPUTE: ObligationType.DISPUTE_RESOLUTION,
      DISPUTE_RESOLUTION: ObligationType.DISPUTE_RESOLUTION,
      EMPLOYER: ObligationType.EMPLOYER_OBLIGATION,
      EMPLOYER_OBLIGATION: ObligationType.EMPLOYER_OBLIGATION,
      CONTRACTOR: ObligationType.CONTRACTOR_OBLIGATION,
      CONTRACTOR_OBLIGATION: ObligationType.CONTRACTOR_OBLIGATION,
      ENGINEER: ObligationType.ENGINEER_OBLIGATION,
      ENGINEER_OBLIGATION: ObligationType.ENGINEER_OBLIGATION,
    };
    return map[upper] ?? ObligationType.OTHER;
  }

  private coerceParty(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const upper = raw.trim().toUpperCase();
    if (upper.includes('CONTRACTOR')) return 'CONTRACTOR';
    if (upper.includes('EMPLOYER') || upper.includes('CLIENT'))
      return 'EMPLOYER';
    if (upper.includes('ENGINEER')) return 'ENGINEER';
    if (upper.includes('BOTH')) return 'BOTH';
    return raw;
  }

  private parseDate(raw: unknown): Date | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    // Reject obvious non-dates like "28 days from instruction"
    if (/^\d+\s*(day|week|month|year)/i.test(trimmed)) return null;
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  private parseAmount(raw: unknown): string | null {
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (Number.isFinite(n)) return n.toFixed(2);
    return null;
  }
}
