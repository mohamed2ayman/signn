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
    @InjectRepository(ComplianceFinding)
    private readonly repo: Repository<ComplianceFinding>,
  ) {}

  async listForCheck(checkId: string): Promise<ComplianceFinding[]> {
    return this.repo.find({
      where: { compliance_check_id: checkId },
      order: { layer: 'ASC', severity: 'ASC' },
    });
  }

  async updateStatus(
    findingId: string,
    nextStatus: ComplianceFindingStatus,
    userId: string,
  ): Promise<ComplianceFinding> {
    const finding = await this.repo.findOne({ where: { id: findingId } });
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
    return this.repo.save(finding);
  }
}
