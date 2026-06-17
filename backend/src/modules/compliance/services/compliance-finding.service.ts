import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ComplianceFinding,
  ComplianceFindingStatus,
} from '../../../database/entities';
// Option B — chokepoint migration (compliance finale): updateStatus loads the
// finding through the data-layer tenancy chokepoint (canonical
// finding→check→contract→project→org) BEFORE the status mutation — UNDER the
// controller's findInOrg wall. Two checks, two layers.
import { ComplianceFindingScopedRepository } from '../../scoped-repository/compliance-finding-scoped.repository';

@Injectable()
export class ComplianceFindingService {
  constructor(
    @InjectRepository(ComplianceFinding) // lint-exempt: write path (save) + pre-wall resolver (getContractIdForFinding) + dead-code listForCheck (no caller); the wired updateStatus by-id read routes through findingScoped
    private readonly repo: Repository<ComplianceFinding>,
    // Option B chokepoint (compliance finale) — layer 2 under the controller wall.
    private readonly findingScoped: ComplianceFindingScopedRepository,
  ) {}

  /**
   * DEAD CODE (no caller anywhere in the backend as of the compliance finale).
   * Left in place rather than removed (out of the chokepoint-migration scope);
   * flagged for a future removal pass. If ever revived, route it through
   * findingScoped.scopedFind with `compliance_check_id` added to the subclass
   * allowlist.
   */
  async listForCheck(checkId: string): Promise<ComplianceFinding[]> {
    return this.repo.find({ // lint-exempt: dead code (no caller); flagged for removal — see method doc
      where: { compliance_check_id: checkId },
      order: { layer: 'ASC', severity: 'ASC' },
    });
  }

  /**
   * Resolve a finding's owning `contract_id` via its parent
   * ComplianceCheck. Used by the controller-level access wall on
   * `:findingId` routes — the URL's `:contractId` param is convention;
   * the TRUTH is `finding → check.contract_id`.
   *
   * Throws `NotFoundException` (same shape as ContractAccessService.findInOrg
   * — no existence leak between "finding absent" and "finding exists in
   * another org").
   */
  async getContractIdForFinding(findingId: string): Promise<string> {
    const row = await this.repo // lint-exempt: pre-wall resolver — resolves the finding's owning contract_id for the controller's findInOrg wall (runs BEFORE the org is known; cannot itself route through an org-scoped chokepoint)
      .createQueryBuilder('f')
      .innerJoin(
        'compliance_checks',
        'check',
        'check.id = f.compliance_check_id',
      )
      .where('f.id = :id', { id: findingId })
      .select('check.contract_id', 'contract_id')
      .getRawOne<{ contract_id: string }>();
    if (!row?.contract_id) throw new NotFoundException('Finding not found');
    return row.contract_id;
  }

  async updateStatus(
    findingId: string,
    nextStatus: ComplianceFindingStatus,
    userId: string,
    orgId: string,
  ): Promise<ComplianceFinding> {
    // Layer 2 (Option B chokepoint): the by-id finding load routes through the
    // canonical `finding → check → contract → project → org` gate (no-existence-
    // leak 404, matching the prior 'Finding not found'). The controller walled
    // the finding's TRUE owning contract_id (layer 1, via getContractIdForFinding
    // → findInOrg); the wall guarantees `orgId` is non-null. The save below
    // operates on the scoped-loaded row.
    const finding = await this.findingScoped.scopedFindByIdOrThrow(
      findingId,
      orgId,
    );

    if (!Object.values(ComplianceFindingStatus).includes(nextStatus)) {
      throw new BadRequestException(`Invalid status: ${nextStatus}`);
    }

    finding.status = nextStatus;
    if (
      nextStatus === ComplianceFindingStatus.ACKNOWLEDGED ||
      nextStatus === ComplianceFindingStatus.RESOLVED ||
      nextStatus === ComplianceFindingStatus.WAIVED
    ) {
      finding.acknowledged_by = userId;
      finding.acknowledged_at = new Date();
    }
    return this.repo.save(finding); // lint-exempt: write (status mutation on the scoped-loaded row); the chokepoint is read-only
  }
}
