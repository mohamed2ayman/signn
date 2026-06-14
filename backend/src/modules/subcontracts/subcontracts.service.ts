import * as crypto from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubContract, SubContractStatusLog } from '../../database/entities/sub-contract.entity';
import { Contract, ContractStatus } from '../../database/entities/contract.entity';
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Option B — S2e: SubContractsService loads its per-main-contract LIST and
// by-id surfaces through SubContractScopedRepository (the data-layer tenancy
// chokepoint, layer 2), UNDER the independent #57 / Tier 3 findInOrg walls
// (layer 1).
import { SubContractScopedRepository } from '../scoped-repository/subcontract-scoped.repository';

@Injectable()
export class SubContractsService {
  constructor(
    @InjectRepository(SubContract)
    private readonly subContractRepo: Repository<SubContract>,
    @InjectRepository(SubContractStatusLog)
    private readonly statusLogRepo: Repository<SubContractStatusLog>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    private readonly contractAccess: ContractAccessService,
    private readonly subContractScoped: SubContractScopedRepository,
  ) {}

  async create(
    dto: Record<string, any> & { main_contract_id: string },
    userId: string,
    orgId: string,
  ): Promise<SubContract> {
    // Tenant-isolation Tier 3 wall — main_contract_id IS a contract id
    // (sub_contract.main_contract_id → contracts.id). Cross-org caller
    // gets 404 (NOT 403) before any DB write or status gate runs.
    const mainContract = await this.contractAccess.findInOrg(
      dto.main_contract_id,
      orgId,
    );

    if (mainContract.status !== ContractStatus.ACTIVE) {
      throw new BadRequestException('Main contract must be ACTIVE to create subcontracts');
    }

    // Auto-generate subcontract number
    const existingCount = await this.subContractRepo.count({
      where: { main_contract_id: dto.main_contract_id },
    });
    const subcontractNumber = `SC-${String(existingCount + 1).padStart(3, '0')}`;

    const subContract = this.subContractRepo.create({
      ...dto,
      subcontract_number: subcontractNumber,
      created_by: userId,
      org_id: orgId,
      status: ContractStatus.DRAFT,
    });

    const saved = await this.subContractRepo.save(subContract);

    await this.logStatusChange(saved.id, userId, null, ContractStatus.DRAFT, 'Subcontract created');

    return saved;
  }

  async findAllByMainContract(
    mainContractId: string,
    orgId: string,
  ): Promise<SubContract[]> {
    // Tenant-isolation Tier 3 wall — cross-org caller gets 404 before
    // the status gate runs.
    const mainContract = await this.contractAccess.findInOrg(mainContractId, orgId);

    if (mainContract.status !== ContractStatus.ACTIVE) {
      throw new BadRequestException('Main contract must be ACTIVE to list subcontracts');
    }

    // SCOPED LIST (tenancy — Option B S2e, layer 2): the org-safe row set comes
    // from the scoped chokepoint, which independently re-applies the canonical
    // sub→main_contract→project→org join. relations/order are single-level
    // (the `mainContract` hydration coexists with the gate join via the
    // distinct org_gate_main_contract alias), so this is a behavior-preserving
    // drop-in for the bare find.
    return this.subContractScoped.scopedFind(
      { main_contract_id: mainContractId },
      orgId,
      { relations: ['creator', 'mainContract'], order: { created_at: 'DESC' } },
    );
  }

  async findById(id: string, orgId: string): Promise<SubContract> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer BEFORE any nested relation is hydrated.
    const scoped = await this.subContractScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the sub-contract's OWN main_contract_id (a real contract id; never a
    // URL-supplied one).
    await this.contractAccess.findInOrg(scoped.main_contract_id, orgId);

    // HYDRATION on the tenancy-validated id — the nested status_logs.changer
    // relation exceeds the scoped base's single-level relation support; the
    // two-step keeps the base minimal instead of growing it.
    const subContract = await this.subContractRepo.findOne({
      where: { id },
      relations: ['creator', 'mainContract', 'status_logs', 'status_logs.changer'],
    });

    if (!subContract) {
      // Row vanished between the scoped load and the hydrate (race) — same
      // no-existence-leak 404.
      throw new NotFoundException('Subcontract not found');
    }

    return subContract;
  }

  async update(
    id: string,
    dto: Record<string, any>,
    userId: string,
    orgId: string,
  ): Promise<SubContract> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer → 404, no existence leak.
    const subContract = await this.subContractScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the sub-contract's OWN main_contract_id.
    await this.contractAccess.findInOrg(subContract.main_contract_id, orgId);

    Object.assign(subContract, dto);
    return this.subContractRepo.save(subContract);
  }

  async updateStatus(
    id: string,
    dto: { status: string; note?: string },
    userId: string,
    orgId: string,
  ): Promise<SubContract> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer → 404, no existence leak.
    const subContract = await this.subContractScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the sub-contract's OWN main_contract_id.
    await this.contractAccess.findInOrg(subContract.main_contract_id, orgId);

    const previousStatus = subContract.status;
    subContract.status = dto.status as ContractStatus;

    const saved = await this.subContractRepo.save(subContract);

    await this.logStatusChange(id, userId, previousStatus, dto.status, dto.note);

    return saved;
  }

  async share(
    id: string,
    userId: string,
    orgId: string,
  ): Promise<{ shareUrl: string; token: string }> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer → 404, no existence leak. share only needs the row to exist
    // in the caller's org before minting a token.
    const subContract = await this.subContractScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the sub-contract's OWN main_contract_id.
    await this.contractAccess.findInOrg(subContract.main_contract_id, orgId);

    const token = crypto.randomBytes(32).toString('hex');

    return {
      shareUrl: `/subcontracts/shared/${token}`,
      token,
    };
  }

  private async logStatusChange(
    subContractId: string,
    userId: string,
    previousStatus: string | null,
    newStatus: string,
    note?: string,
  ): Promise<void> {
    const log = this.statusLogRepo.create({
      sub_contract_id: subContractId,
      changed_by: userId,
      previous_status: previousStatus ?? '',
      new_status: newStatus,
      note: note || undefined,
    });

    await this.statusLogRepo.save(log);
  }
}
