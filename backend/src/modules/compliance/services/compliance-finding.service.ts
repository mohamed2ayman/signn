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

@Injectable()
export class ComplianceFindingService {
  constructor(
    @InjectRepository(ComplianceFinding) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
    private readonly repo: Repository<ComplianceFinding>,
  ) {}

  async listForCheck(checkId: string): Promise<ComplianceFinding[]> {
    return this.repo.find({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
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
    const row = await this.repo // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
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
  ): Promise<ComplianceFinding> {
    const finding = await this.repo.findOne({ where: { id: findingId } }); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
    if (!finding) throw new NotFoundException('Finding not found');

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
    return this.repo.save(finding); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
  }
}
