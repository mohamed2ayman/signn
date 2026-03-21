import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { Obligation, ObligationStatus } from '../../database/entities';
import { CreateObligationDto, UpdateObligationDto } from './dto';

@Injectable()
export class ObligationsService {
  private readonly logger = new Logger(ObligationsService.name);

  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepository: Repository<Obligation>,
  ) {}

  async findByContract(contractId: string): Promise<Obligation[]> {
    return this.obligationRepository.find({
      where: { contract_id: contractId },
      relations: ['contract_clause', 'contract_clause.clause', 'completer'],
      order: { due_date: 'ASC' },
    });
  }

  async findById(id: string): Promise<Obligation> {
    const obligation = await this.obligationRepository.findOne({
      where: { id },
      relations: ['contract', 'contract_clause', 'contract_clause.clause', 'completer'],
    });

    if (!obligation) {
      throw new NotFoundException('Obligation not found');
    }

    return obligation;
  }

  async create(dto: CreateObligationDto): Promise<Obligation> {
    const obligation = this.obligationRepository.create({
      ...dto,
      status: ObligationStatus.PENDING,
    });

    return this.obligationRepository.save(obligation);
  }

  async update(id: string, dto: UpdateObligationDto): Promise<Obligation> {
    const obligation = await this.findById(id);

    if (dto.description !== undefined) obligation.description = dto.description;
    if (dto.responsible_party !== undefined) obligation.responsible_party = dto.responsible_party;
    if (dto.due_date !== undefined) obligation.due_date = new Date(dto.due_date);
    if (dto.frequency !== undefined) obligation.frequency = dto.frequency;
    if (dto.status !== undefined) obligation.status = dto.status;
    if (dto.reminder_days_before !== undefined) obligation.reminder_days_before = dto.reminder_days_before;
    if (dto.evidence_url !== undefined) obligation.evidence_url = dto.evidence_url;

    return this.obligationRepository.save(obligation);
  }

  async complete(id: string, userId: string, evidenceUrl?: string): Promise<Obligation> {
    const obligation = await this.findById(id);

    obligation.status = ObligationStatus.COMPLETED;
    obligation.completed_at = new Date();
    obligation.completed_by = userId;
    if (evidenceUrl) obligation.evidence_url = evidenceUrl;

    return this.obligationRepository.save(obligation);
  }

  async delete(id: string): Promise<void> {
    const obligation = await this.findById(id);
    await this.obligationRepository.remove(obligation);
  }

  async getUpcoming(daysAhead: number = 30): Promise<Obligation[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return this.obligationRepository.find({
      where: {
        due_date: LessThanOrEqual(futureDate),
        status: In([ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS]),
      },
      relations: ['contract', 'contract_clause'],
      order: { due_date: 'ASC' },
    });
  }

  async getOverdue(): Promise<Obligation[]> {
    const qb = this.obligationRepository
      .createQueryBuilder('obligation')
      .leftJoinAndSelect('obligation.contract', 'contract')
      .leftJoinAndSelect('obligation.contract_clause', 'contract_clause')
      .where('obligation.due_date < NOW()')
      .andWhere('obligation.status IN (:...statuses)', {
        statuses: [ObligationStatus.PENDING, ObligationStatus.IN_PROGRESS],
      })
      .orderBy('obligation.due_date', 'ASC');

    return qb.getMany();
  }

  async getDashboard(contractId?: string): Promise<{
    total: number;
    by_status: Record<string, number>;
    overdue_count: number;
    upcoming_7_days: number;
  }> {
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
