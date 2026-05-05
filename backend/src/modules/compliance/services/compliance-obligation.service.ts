import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ComplianceCheck,
  Contract,
  Obligation,
  ObligationStatus,
  ObligationType,
} from '../../../database/entities';

/**
 * Layer-4 (obligation extraction) post-processor.
 *
 * Takes the raw output from the obligations extractor agent and bulk-
 * creates Obligation rows linked to the compliance check, with the
 * compliance-aware fields populated (obligation_type, clause_ref,
 * duration, timeframe_description, amount, currency, is_critical,
 * project_id).
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

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepo: Repository<Obligation>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
  ) {}

  async persistFromExtraction(
    check: ComplianceCheck,
    rawObligations: any[],
  ): Promise<number> {
    if (!Array.isArray(rawObligations) || rawObligations.length === 0) {
      return 0;
    }
    const contract = await this.contractRepo.findOne({
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
    await this.obligationRepo.insert(rows as any);
    return rows.length;
  }

  // ─── Coercion helpers ─────────────────────────────────────

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
