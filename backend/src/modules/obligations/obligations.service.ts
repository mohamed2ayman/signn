import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Obligation, ObligationStatus } from '../../database/entities';
import { CreateObligationDto, UpdateObligationDto } from './dto';
// Tenant-isolation Tier 2 — wall the dashboard's optional contract_id
// filter via ContractAccessService.findInOrg. The other contract-keyed
// route on this controller (`GET /obligations/contract/:contractId`) is
// PLG-entangled (Class-C) and moves to Option B — see
// docs/tenant-isolation-tier2.md.
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Option B — S2c-2: the by-id loads (findById and its update/complete/delete
// inheritors) and the findByContract tenancy step go through the
// scoped-repository chokepoint (canonical obligation→contract→project→org),
// UNDER the #60/S0 walls — two checks, two layers.
import { ObligationScopedRepository } from '../scoped-repository/obligation-scoped.repository';

@Injectable()
export class ObligationsService {
  private readonly logger = new Logger(ObligationsService.name);

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
    // Tenant-isolation Tier 2 — cross-tenant probe → 404 from findInOrg.
    private readonly contractAccess: ContractAccessService,
    // S2c-2 — data-layer tenancy load for the by-id mutation surface.
    private readonly obligationScoped: ObligationScopedRepository,
  ) {}

  async findByContract(
    contractId: string,
    orgId: string,
  ): Promise<Obligation[]> {
    // WALL (persona — S0, layer 1): Class-C bypass-role wall, unchanged.
    if (!orgId) {
      // No-org caller cannot own contracts. 404 (not 403) — no existence leak.
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);
    // SCOPED LIST (tenancy — Option B S2c-2, layer 2), STEP 1 of the
    // two-step: the org-safe row set comes from the scoped chokepoint, which
    // independently re-applies the canonical obligation→contract→project→org
    // join. Cross-tenant rows are excluded even if the wall above were
    // bypassed.
    const scoped = await this.obligationScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );
    if (scoped.length === 0) {
      return [];
    }
    // STEP 2 — hydration on the tenancy-validated ids ONLY. The nested
    // 'contract_clause.clause' relation exceeds scopedFind's single-level
    // relation support; the two-step keeps the scoped base minimal instead
    // of growing it (S2c-2 plan). Keying by the validated ids (never by raw
    // request input) carries the tenancy proof into the hydrate.
    return this.obligationRepository.find({
      where: { id: In(scoped.map((o) => o.id)) },
      relations: ['contract_clause', 'contract_clause.clause', 'completer'],
      order: { due_date: 'ASC' },
    });
  }

  /**
   * By-id load for the /:id surface and its mutation inheritors
   * (update/complete/delete).
   *
   * Option B S2c-2 — two checks, two layers:
   *   layer 2 (tenancy, data load): scopedFindByIdOrThrow resolves the
   *     obligation through the canonical obligation→contract→project→org
   *     join. Cross-org → 404 (never 403, no existence leak) BEFORE any
   *     foreign field is hydrated.
   *   layer 1 (persona, #60 wall): findInOrg on the scoped row's contract
   *     STAYS as defense-in-depth, unchanged.
   * The trailing findOne is HYDRATION on the tenancy-validated id — the
   * nested 'contract_clause.clause' relation exceeds the scoped base's
   * single-level relation support (same two-step as findByContract).
   */
  async findById(id: string, orgId: string): Promise<Obligation> {
    if (!orgId) {
      // No-org caller cannot own contracts. 404 — no existence leak.
      throw new NotFoundException('Obligation not found');
    }
    // SCOPED LOAD (tenancy — layer 2): cross-org denied at the data layer.
    const scoped = await this.obligationScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #60, layer 1): stays as defense-in-depth.
    await this.contractAccess.findInOrg(scoped.contract_id, orgId);

    // HYDRATION on the validated id (nested relations — see doc comment).
    const obligation = await this.obligationRepository.findOne({
      where: { id },
      relations: ['contract', 'contract_clause', 'contract_clause.clause', 'completer'],
    });

    if (!obligation) {
      // Row vanished between the scoped load and the hydrate (race) — same
      // no-existence-leak 404.
      throw new NotFoundException('Obligation not found');
    }

    return obligation;
  }

  async create(dto: CreateObligationDto, orgId: string): Promise<Obligation> {
    // WALL (tenant-isolation hotfix, pre-S2d): create() inserts an obligation
    // keyed by the body-supplied dto.contract_id. Pre-fix there was NO
    // contract-in-org check — the route middleware only resolves a project
    // from req.params (contract_id lives in the BODY here), so the permission
    // guard falls through and a caller could insert against ANOTHER org's
    // contract (a live cross-tenant write). Resolve the contract through the
    // caller's org via findInOrg BEFORE inserting — cross-tenant → 404 (never
    // 403, no existence leak). Same primitive as the #60 hotfix and the
    // S2c-2 by-id mutation surface.
    //
    // This is an insert keyed by a request-body field, not a by-id load, so
    // it stays a stop-gap wall and deliberately does NOT route through the
    // scoped repository (those chokepoints serve the by-id paths).
    if (!orgId) {
      // No-org caller cannot own contracts. 404 — no existence leak.
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(dto.contract_id, orgId);

    const obligation = this.obligationRepository.create({
      ...dto,
      status: ObligationStatus.PENDING,
    });

    return this.obligationRepository.save(obligation);
  }

  // S2c-2: update/complete/delete inherit BOTH layers (the scoped tenancy
  // load and the #60 wall) by flowing through findById — none of them does a
  // bare repo load of its own. The save/remove below operate on the
  // scoped-then-hydrated row.

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
    if (contractId) {
      await this.contractAccess.findInOrg(contractId, orgId);
    } else if (!orgId) {
      // POST-#60 HOTFIX: no-org caller owns no contracts — zeroed dashboard,
      // repo never queried, no existence leak (mirrors getUpcoming/getOverdue).
      return { total: 0, by_status: {}, overdue_count: 0, upcoming_7_days: 0 };
    }
    const qb = this.obligationRepository.createQueryBuilder('obligation');
    if (contractId) {
      qb.where('obligation.contract_id = :contractId', { contractId });
    } else {
      // POST-#60 HOTFIX (Ayman ruling): the contract-less branch was a BUG —
      // it ran UNFILTERED, aggregating every tenant's obligations for any
      // authenticated caller. Org-scope it via the canonical join
      // (obligation.contract → contract.project AND p.organization_id =
      // :orgId) — same posture as getUpcoming/getOverdue above. S2c later
      // subsumes this read into the scoped chokepoint; the predicate stays
      // as defense-in-depth.
      qb.leftJoin('obligation.contract', 'contract')
        .leftJoin('contract.project', 'p')
        .where('p.organization_id = :orgId', { orgId });
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
