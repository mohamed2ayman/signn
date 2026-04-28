import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NegotiationEvent,
  NegotiationEventSource,
  Contract,
  Project,
} from '../../database/entities';
import { CreateNegotiationEventDto } from './dto';

@Injectable()
export class NegotiationService {
  constructor(
    @InjectRepository(NegotiationEvent)
    private readonly eventRepository: Repository<NegotiationEvent>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
  ) {}

  async createEvent(
    dto: CreateNegotiationEventDto,
    userId: string,
    orgId: string,
    source: NegotiationEventSource,
  ): Promise<NegotiationEvent> {
    await this.assertContractInOrg(dto.contract_id, orgId);

    const event = this.eventRepository.create({
      contract_id: dto.contract_id,
      clause_ref: dto.clause_ref,
      event_type: dto.event_type,
      original_text: dto.original_text ?? null,
      new_text: dto.new_text ?? null,
      performed_by: userId,
      source,
    });
    return this.eventRepository.save(event);
  }

  async findHistory(
    contractId: string,
    orgId: string,
    options: { clause_ref?: string; limit?: number; offset?: number },
  ): Promise<{ events: NegotiationEvent[]; total: number }> {
    await this.assertContractInOrg(contractId, orgId);

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const qb = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.performer', 'performer')
      .where('event.contract_id = :contractId', { contractId })
      .orderBy('event.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (options.clause_ref) {
      qb.andWhere('event.clause_ref = :clauseRef', {
        clauseRef: options.clause_ref,
      });
    }

    const [events, total] = await qb.getManyAndCount();
    return { events, total };
  }

  private async assertContractInOrg(
    contractId: string,
    orgId: string,
  ): Promise<void> {
    const contract = await this.contractRepository
      .createQueryBuilder('contract')
      .innerJoin(Project, 'project', 'project.id = contract.project_id')
      .where('contract.id = :contractId', { contractId })
      .andWhere('project.organization_id = :orgId', { orgId })
      .getOne();

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
  }
}
