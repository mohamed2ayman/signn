import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Obligation, ObligationStatus } from '../../database/entities';
import { CreateObligationDto, UpdateObligationDto } from './dto';
// Tenant-isolation Tier 2 — wall the dashboard's optional contract_id
// filter via ContractAccessService.findInOrg. The other contract-keyed
// route on this controller (`GET /obligations/contract/:contractId`) is
// PLG-entangled (Class-C) and moves to Option B — see
// docs/tenant-isolation-tier2.md.
import { ContractAccessService } from '../contracts/services/contract-access.service';

@Injectable()
export class ObligationsService {
  private readonly logger = new Logger(ObligationsService.name);

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
    // Tenant-isolation Tier 2 — cross-tenant probe → 404 from findInOrg.
    private readonly contractAccess: ContractAccessService,
  ) {}

  async findByContract(
    contractId: string,
    orgId: string,
  ): Promise<Obligation[]> {
    // INTERIM (S0): Class-C bypass-role wall. Option B will absorb this via the
    //  scoped repository chokepoint — this findInOrg is the stop-gap until then.
    // PLG bypass-roles (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS) skip the project-
    // membership check, and this load was unscoped — so a foreign contract's
    // obligations leaked regardless of role. findInOrg applies the org gate at
    // the data load; cross-tenant → 404.
    if (!orgId) {
      // No-org caller cannot own contracts. 404 (not 403) — no existence leak.
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);
    return this.obligationRepository.find({
      where: { contract_id: contractId },
      relations: ['contract_clause', 'contract_clause.clause', 'completer'],
      order: { due_date: 'ASC' },
    });
  }

  /**
   * PRE-S2c HOTFIX: org wall on the /:id surface. Pre-fix this load had no
   * org anywhere — Phase 7.15 permission gating is NOT a tenancy boundary
   * (bypass roles skip it), so an org-A caller could read/mutate/DELETE an
   * org-B obligation by id (update/complete/delete all feed off this load).
   * After loading by id, the obligation's contract is resolved in the
   * caller's org via findInOrg — cross-tenant → 404 (never 403, no
   * existence leak). S2c absorbs this into the scoped chokepoint; the wall
   * stays as defense-in-depth.
   */
  async findById(id: string, orgId: string): Promise<Obligation> {
    if (!orgId) {
      // No-org caller cannot own contracts. 404 — no existence leak.
      throw new NotFoundException('Obligation not found');
    }
    const obligation = await this.obligationRepository.findOne({
      where: { id },
      relations: ['contract', 'contract_clause', 'contract_clause.clause', 'completer'],
    });

    if (!obligation) {
      throw new NotFoundException('Obligation not found');
    }

    await this.contractAccess.findInOrg(obligation.contract_id, orgId);

    return obligation;
  }

  async create(dto: CreateObligationDto): Promise<Obligation> {
    const obligation = this.obligationRepository.create({
      ...dto,
      status: ObligationStatus.PENDING,
    });

    return this.obligationRepository.save(obligation);
  }

  // PRE-S2c HOTFIX: update/complete/delete inherit the org wall by flowing
  // through the now-scoped findById — none of them does a bare repo load.

  async update(
    id: string,
    dto: UpdateObligationDto,
    orgId: string,
  ): Promise<Obligation> {
    const obligation = await this.findById(id, orgId);

    if (dto.description !== undefined) obligation.description = dto.description;
    if (dto.responsible_party !== undefined) obligation.responsible_party = dto.responsible_party;
    if (dto.due_date !== undefined) obligation.due_date = new Date(dto.due_date);
    if (dto.frequency !== undefined) obligation.frequency = dto.frequency;
    if (dto.status !== undefined) obligation.status = dto.status;
    if (dto.reminder_days_before !== undefined) obligation.reminder_days_before = dto.reminder_days_before;
    if (dto.evidence_url !== undefined) obligation.evidence_url = dto.evidence_url;

    return this.obligationRepository.save(obligation);
  }

  async complete(
    id: string,
    userId: string,
    orgId: string,
    evidenceUrl?: string,
  ): Promise<Obligation> {
    const obligation = await this.findById(id, orgId);

    obligation.status = ObligationStatus.COMPLETED;
    obligation.completed_at = new Date();
    obligation.completed_by = userId;
    if (evidenceUrl) obligation.evidence_url = evidenceUrl;

    return this.obligationRepository.save(obligation);
  }

  async delete(id: string, orgId: string): Promise<void> {
    const obligation = await this.findById(id, orgId);
    await this.obligationRepository.remove(obligation);
  }

  // PRE-S2c HOTFIX: getUpcoming/getOverdue were PLATFORM-WIDE (no org
  // predicate). Both now take the caller's orgId and apply the canonical
  // org join (obligation.contract → contract.project AND
  // p.organization_id = :orgId) — same posture as getPortfolio/getCalendar
  // in ComplianceObligationService. S2c later subsumes these reads into the
  // scoped chokepoint; the predicate stays as defense-in-depth.

  async getUpcoming(orgId: string, daysAhead: number = 30): Promise<Obligation[]> {
    if (!orgId) {
      // No-org caller owns no contracts — empty, no existence leak.
      return [];
    }
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return this.obligationRepository
      .createQueryBuilder('obligation')
      .leftJoinAndSelect('obligation.contract', 'contract')
      .leftJoinAndSelect('obligation.contract_clause', 'contract_clause')
      .leftJoin('contract.project', 'p')
      .where('obligation.due_date <= :futureDate', { futureDate })
      .andWhere('obligation.status IN (:...statuses)', {
        statuses: [ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS],
      })
      .andWhere('p.organization_id = :orgId', { orgId })
      .orderBy('obligation.due_date', 'ASC')
      .getMany();
  }

  async getOverdue(orgId: string): Promise<Obligation[]> {
    if (!orgId) {
      // No-org caller owns no contracts — empty, no existence leak.
      return [];
    }
    const qb = this.obligationRepository
      .createQueryBuilder('obligation')
      .leftJoinAndSelect('obligation.contract', 'contract')
      .leftJoinAndSelect('obligation.contract_clause', 'contract_clause')
      .leftJoin('contract.project', 'p')
      .where('obligation.due_date < NOW()')
      .andWhere('obligation.status IN (:...statuses)', {
        statuses: [ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS],
      })
      .andWhere('p.organization_id = :orgId', { orgId })
      .orderBy('obligation.due_date', 'ASC');

    return qb.getMany();
  }

  async getDashboard(
    orgId: string,
    contractId?: string,
  ): Promise<{
    total: number;
    by_status: Record<string, number>;
    overdue_count: number;
    upcoming_7_days: number;
  }> {
    // Tenant-isolation Tier 2 — when contract_id is supplied, wall it.
    // Without it the dashboard remains org-wide (no contract context, so
    // tenant scoping doesn't apply at this layer — same posture as the
    // sibling /upcoming and /overdue endpoints).
    if (contractId) {
      await this.contractAccess.findInOrg(contractId, orgId);
    }
    const qb = this.obligationRepository.createQueryBuilder('obligation');
    if (contractId) {
      qb.where('obligation.contract_id = :contractId', { contractId });
    }

    const obligations = await qb.getMany();

    const now = new Date();
    const sevenDays = new Date();
    sevenDays.setDate(sevenDays.getDate() + 7);

    const byStatus: Record<string, number> = {};
    let overdueCount = 0;
    let upcoming7Days = 0;

    for (const o of obligations) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;

      if (
        o.due_date &&
        new Date(o.due_date) < now &&
        [ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS].includes(o.status as ObligationStatus)
      ) {
        overdueCount++;
      }

      if (
        o.due_date &&
        new Date(o.due_date) >= now &&
        new Date(o.due_date) <= sevenDays
      ) {
        upcoming7Days++;
      }
    }

    return {
      total: obligations.length,
      by_status: byStatus,
      overdue_count: overdueCount,
      upcoming_7_days: upcoming7Days,
    };
  }
}
