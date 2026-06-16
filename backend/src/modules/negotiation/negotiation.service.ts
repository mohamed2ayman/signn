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
// Option B — Chokepoint migration (negotiation, 1 of 4): the findHistory LIST
// read loads through NegotiationEventScopedRepository (the data-layer tenancy
// chokepoint, layer 2) UNDER the inline assertContractInOrg wall (layer 1).
import { NegotiationEventScopedRepository } from '../scoped-repository/negotiation-event-scoped.repository';

@Injectable()
export class NegotiationService {
  constructor(
    // Kept bare for the WRITE path (createEvent's save); reads go via the scoped
    // chokepoint, behind the assertContractInOrg wall.
    @InjectRepository(NegotiationEvent) // lint-exempt: wall-protected (assertContractInOrg) — write path; reads via scoped chokepoint
    private readonly eventRepository: Repository<NegotiationEvent>,
    // Backs ONLY the inline assertContractInOrg wall (the canonical org gate);
    // KEPT inline by deliberate decision — not consolidated into findInOrg.
    @InjectRepository(Contract) // lint-exempt: inline contract-access wall (canonical contract→project→org gate)
    private readonly contractRepository: Repository<Contract>,
    private readonly negotiationEventScoped: NegotiationEventScopedRepository,
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
    return this.eventRepository.save(event); // lint-exempt: wall-protected (assertContractInOrg) — row validated before write
  }

  async findHistory(
    contractId: string,
    orgId: string,
    options: { clause_ref?: string; limit?: number; offset?: number },
  ): Promise<{ events: NegotiationEvent[]; total: number }> {
    // WALL (layer 1) — the inline canonical org gate STAYS as defense-in-depth.
    // Cross-org caller gets a no-leak 404 before any row is read.
    await this.assertContractInOrg(contractId, orgId);

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    // SCOPED LIST (tenancy — Option B chokepoint, layer 2): the org-safe row set
    // + total come from the scoped chokepoint, which independently re-applies the
    // canonical event→contract→project→org join. Cross-tenant rows are excluded
    // (and never counted in `total`) even if the wall above were bypassed. The
    // filter, single-level `performer` relation, order, and pagination are a
    // behavior-preserving drop-in for the bare getManyAndCount QB.
    const filter: { contract_id: string; clause_ref?: string } = {
      contract_id: contractId,
    };
    if (options.clause_ref) {
      filter.clause_ref = options.clause_ref;
    }

    const [events, total] = await this.negotiationEventScoped.scopedFindAndCount(
      filter,
      orgId,
      {
        relations: ['performer'],
        order: { created_at: 'DESC' },
        take: limit,
        skip: offset,
      },
    );
    return { events, total };
  }

  /**
   * The inline contract-access WALL (layer 1) — negotiation's home-grown
   * canonical `contract → project → organization_id` gate. KEPT inline by
   * deliberate decision (chokepoint migration, negotiation bucket): it enforces
   * the exact same gate + no-leak 404 as ContractAccessService.findInOrg, but is
   * a lightweight existence check rather than findInOrg's heavy hydrating load
   * (whose result the callers here discard). Consolidating would add a
   * cross-module dependency and run the heavier query for no gain. The scoped
   * chokepoint sits UNDERNEATH this wall as layer 2 (two checks, never a swap).
   */
  private async assertContractInOrg(
    contractId: string,
    orgId: string,
  ): Promise<void> {
    const contract = await this.contractRepository // lint-exempt: inline contract-access wall (canonical contract→project→org gate)
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
