import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../database/entities';
import {
  Claim,
  ClaimDocument,
  ClaimResponse,
  ClaimStatusLog,
  ClaimStatus,
} from '../../database/entities/claim.entity';
import {
  CreateClaimDto,
  UpdateClaimStatusDto,
  CreateClaimResponseDto,
  UploadClaimDocumentDto,
} from './dto';
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Option B — S2e: ClaimsService loads its per-contract LIST and by-id surfaces
// through ClaimScopedRepository (the data-layer tenancy chokepoint, layer 2),
// UNDER the independent #57 / Tier 3 findInOrg walls (layer 1).
import { ClaimScopedRepository } from '../scoped-repository/claim-scoped.repository';

@Injectable()
export class ClaimsService {
  constructor(
    @InjectRepository(Claim) // lint-exempt: two-step hydration (ids validated by scoped load)
    private readonly claimRepo: Repository<Claim>,

    @InjectRepository(ClaimDocument)
    private readonly claimDocumentRepo: Repository<ClaimDocument>,

    @InjectRepository(ClaimResponse)
    private readonly claimResponseRepo: Repository<ClaimResponse>,

    @InjectRepository(ClaimStatusLog)
    private readonly claimStatusLogRepo: Repository<ClaimStatusLog>,

    @InjectRepository(Contract) // lint-exempt: two-step hydration (ids validated by scoped load)
    private readonly contractRepo: Repository<Contract>,

    private readonly contractAccess: ContractAccessService,

    private readonly claimScoped: ClaimScopedRepository,
  ) {}

  async create(
    dto: CreateClaimDto,
    userId: string,
    orgId: string,
  ): Promise<Claim> {
    // Tenant-isolation Tier 3 wall — fires BEFORE any DB write or status
    // gate. Cross-org caller gets 404 (NOT 403) — no existence leak.
    const contract = await this.contractAccess.findInOrg(dto.contract_id, orgId);

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Claims can only be created for ACTIVE contracts',
      );
    }

    const existingCount = await this.claimRepo.count({ // lint-exempt: create-sequence count (per-contract, behind findInOrg wall)
      where: { contract_id: dto.contract_id },
    });

    const sequenceNumber = existingCount + 1;
    const claimReference = `CLM-${String(sequenceNumber).padStart(3, '0')}`;

    const claim = this.claimRepo.create({
      contract_id: dto.contract_id,
      org_id: orgId,
      submitted_by: userId,
      claim_reference: claimReference,
      claim_type: dto.claim_type,
      title: dto.title,
      description: dto.description,
      event_date: dto.event_date as unknown as Date,
      claimed_amount: dto.claimed_amount,
      claimed_time_extension_days: dto.claimed_time_extension_days,
      contract_clause_references: dto.contract_clause_references,
      status: ClaimStatus.DRAFT,
    });

    return this.claimRepo.save(claim); // lint-exempt: wall-protected (findInOrg) — row validated before write
  }

  async findAllByContract(contractId: string, orgId: string): Promise<Claim[]> {
    // Tenant-isolation Tier 3 wall — cross-org caller gets 404 before
    // the status gate runs.
    const contract = await this.contractAccess.findInOrg(contractId, orgId);

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Claims can only be viewed for ACTIVE contracts',
      );
    }

    // SCOPED LIST (tenancy — Option B S2e, layer 2): the org-safe row set comes
    // from the scoped chokepoint, which independently re-applies the canonical
    // claim→contract→project→org join. relations/order are single-level, so this
    // is a behavior-preserving drop-in for the bare find (no two-step needed).
    return this.claimScoped.scopedFind(
      { contract_id: contractId },
      orgId,
      { relations: ['submitter', 'documents'], order: { created_at: 'DESC' } },
    );
  }

  async findById(id: string, orgId: string): Promise<Claim> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer BEFORE any nested relation is hydrated.
    const scoped = await this.claimScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the scoped row's OWN contract_id. This is the shared loader, so
    // acknowledge/respond/updateStatus inherit both layers.
    await this.contractAccess.findInOrg(scoped.contract_id, orgId);

    // HYDRATION on the tenancy-validated id — the nested relations exceed the
    // scoped base's single-level relation support; the two-step keeps the base
    // minimal instead of growing it.
    const claim = await this.claimRepo.findOne({ // lint-exempt: two-step hydration (ids validated by scoped load)
      where: { id },
      relations: [
        'submitter',
        'documents',
        'documents.uploader',
        'responses',
        'responses.responder',
        'status_logs',
        'status_logs.changer',
        'contract',
      ],
    });

    if (!claim) {
      // Row vanished between the scoped load and the hydrate (race) — same
      // no-existence-leak 404.
      throw new NotFoundException('Claim not found');
    }

    return claim;
  }

  async acknowledge(id: string, userId: string, orgId: string): Promise<Claim> {
    const claim = await this.findById(id, orgId);
    const previousStatus = claim.status;

    claim.status = ClaimStatus.ACKNOWLEDGED;
    claim.acknowledged_at = new Date();

    const saved = await this.claimRepo.save(claim); // lint-exempt: wall-protected (findInOrg) — row validated before write

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      ClaimStatus.ACKNOWLEDGED,
    );

    return saved;
  }

  async respond(
    id: string,
    dto: CreateClaimResponseDto,
    userId: string,
    orgId: string,
  ): Promise<ClaimResponse> {
    const claim = await this.findById(id, orgId);
    const previousStatus = claim.status;

    const response = this.claimResponseRepo.create({
      claim_id: id,
      responded_by: userId,
      response_type: dto.response_type,
      response_content: dto.response_content,
      counter_amount: dto.counter_amount,
      counter_time_days: dto.counter_time_days,
      justification: dto.justification,
    });

    const savedResponse = await this.claimResponseRepo.save(response);

    claim.status = ClaimStatus.RESPONDED;
    await this.claimRepo.save(claim); // lint-exempt: wall-protected (findInOrg) — row validated before write

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      ClaimStatus.RESPONDED,
    );

    return savedResponse;
  }

  async updateStatus(
    id: string,
    dto: UpdateClaimStatusDto,
    userId: string,
    orgId: string,
  ): Promise<Claim> {
    const claim = await this.findById(id, orgId);
    const previousStatus = claim.status;

    const terminalStatuses: ClaimStatus[] = [
      ClaimStatus.SETTLED,
      ClaimStatus.REJECTED,
    ];

    if (terminalStatuses.includes(claim.status)) {
      throw new BadRequestException(
        `Cannot transition from terminal status ${claim.status}`,
      );
    }

    claim.status = dto.status;

    if (terminalStatuses.includes(dto.status)) {
      claim.resolved_at = new Date();
    }

    const saved = await this.claimRepo.save(claim); // lint-exempt: wall-protected (findInOrg) — row validated before write

    await this.logStatusChange(id, userId, previousStatus, dto.status, dto.note);

    return saved;
  }

  async uploadDocument(
    id: string,
    dto: UploadClaimDocumentDto,
    userId: string,
    orgId: string,
  ): Promise<ClaimDocument> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): this path loads the claim
    // directly (not via findById), so it carries its OWN scoped load. Cross-org
    // denied at the data layer → 404 ('Claim not found'), no existence leak.
    const claim = await this.claimScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the claim's OWN parent contract_id (never a URL-supplied contractId).
    await this.contractAccess.findInOrg(claim.contract_id, orgId);

    const document = this.claimDocumentRepo.create({
      claim_id: id,
      file_url: dto.file_url,
      file_name: dto.file_name,
      document_type: dto.document_type,
      uploaded_by: userId,
    });

    return this.claimDocumentRepo.save(document);
  }

  private async logStatusChange(
    claimId: string,
    userId: string,
    previousStatus: string,
    newStatus: string,
    note?: string,
  ): Promise<ClaimStatusLog> {
    const log = this.claimStatusLogRepo.create({
      claim_id: claimId,
      changed_by: userId,
      previous_status: previousStatus,
      new_status: newStatus,
      note,
    });

    return this.claimStatusLogRepo.save(log);
  }
}
