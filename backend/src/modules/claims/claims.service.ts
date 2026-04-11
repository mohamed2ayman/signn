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

@Injectable()
export class ClaimsService {
  constructor(
    @InjectRepository(Claim)
    private readonly claimRepo: Repository<Claim>,

    @InjectRepository(ClaimDocument)
    private readonly claimDocumentRepo: Repository<ClaimDocument>,

    @InjectRepository(ClaimResponse)
    private readonly claimResponseRepo: Repository<ClaimResponse>,

    @InjectRepository(ClaimStatusLog)
    private readonly claimStatusLogRepo: Repository<ClaimStatusLog>,

    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
  ) {}

  async create(
    dto: CreateClaimDto,
    userId: string,
    orgId: string,
  ): Promise<Claim> {
    const contract = await this.contractRepo.findOne({
      where: { id: dto.contract_id },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Claims can only be created for ACTIVE contracts',
      );
    }

    const existingCount = await this.claimRepo.count({
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

    return this.claimRepo.save(claim);
  }

  async findAllByContract(contractId: string): Promise<Claim[]> {
    const contract = await this.contractRepo.findOne({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Claims can only be viewed for ACTIVE contracts',
      );
    }

    return this.claimRepo.find({
      where: { contract_id: contractId },
      relations: ['submitter', 'documents'],
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string): Promise<Claim> {
    const claim = await this.claimRepo.findOne({
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
      throw new NotFoundException('Claim not found');
    }

    return claim;
  }

  async acknowledge(id: string, userId: string): Promise<Claim> {
    const claim = await this.findById(id);
    const previousStatus = claim.status;

    claim.status = ClaimStatus.ACKNOWLEDGED;
    claim.acknowledged_at = new Date();

    const saved = await this.claimRepo.save(claim);

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
  ): Promise<ClaimResponse> {
    const claim = await this.findById(id);
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
    await this.claimRepo.save(claim);

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
  ): Promise<Claim> {
    const claim = await this.findById(id);
    const previousStatus = claim.status;

    const terminalStatuses: ClaimStatus[] = [
      ClaimStatus.SETTLED,
      ClaimStatus.REJECTED,
      ClaimStatus.WITHDRAWN,
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

    const saved = await this.claimRepo.save(claim);

    await this.logStatusChange(id, userId, previousStatus, dto.status, dto.note);

    return saved;
  }

  async uploadDocument(
    id: string,
    dto: UploadClaimDocumentDto,
    userId: string,
  ): Promise<ClaimDocument> {
    const claim = await this.claimRepo.findOne({ where: { id } });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    const document = this.claimDocumentRepo.create({
      claim_id: id,
      file_url: dto.file_url,
      file_name: dto.file_name,
      document_type: dto.document_type,
      uploaded_by: userId,
    });

    return this.claimDocumentRepo.save(document);
  }

  async withdraw(id: string, userId: string): Promise<Claim> {
    const claim = await this.findById(id);
    const previousStatus = claim.status;

    claim.status = ClaimStatus.WITHDRAWN;
    claim.resolved_at = new Date();

    const saved = await this.claimRepo.save(claim);

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      ClaimStatus.WITHDRAWN,
    );

    return saved;
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
