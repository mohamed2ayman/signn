import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Contract,
  ContractStatus,
  ContractClause,
  ContractVersion,
  ContractComment,
  ContractorResponse,
} from '../../database/entities';
import {
  CreateContractDto,
  UpdateContractDto,
  AddClauseDto,
  UpdateClauseOrderDto,
  AddCommentDto,
  UpdateStatusDto,
} from './dto';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(ContractClause)
    private readonly contractClauseRepository: Repository<ContractClause>,
    @InjectRepository(ContractVersion)
    private readonly contractVersionRepository: Repository<ContractVersion>,
    @InjectRepository(ContractComment)
    private readonly contractCommentRepository: Repository<ContractComment>,
    @InjectRepository(ContractorResponse)
    private readonly contractorResponseRepository: Repository<ContractorResponse>,
  ) {}

  // ─── Contract CRUD ─────────────────────────────────────────

  async findAll(
    projectId: string,
    filters?: {
      status?: string;
      contract_type?: string;
      search?: string;
    },
  ): Promise<Contract[]> {
    const qb = this.contractRepository
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.creator', 'creator')
      .where('contract.project_id = :projectId', { projectId });

    if (filters?.status) {
      qb.andWhere('contract.status = :status', { status: filters.status });
    }

    if (filters?.contract_type) {
      qb.andWhere('contract.contract_type = :contractType', {
        contractType: filters.contract_type,
      });
    }

    if (filters?.search) {
      qb.andWhere('contract.name ILIKE :search', {
        search: `%${filters.search}%`,
      });
    }

    qb.orderBy('contract.updated_at', 'DESC');

    return qb.getMany();
  }

  async findById(id: string): Promise<Contract> {
    const contract = await this.contractRepository.findOne({
      where: { id },
      relations: [
        'creator',
        'approver',
        'project',
        'contract_clauses',
        'contract_clauses.clause',
      ],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Sort clauses by order_index
    if (contract.contract_clauses) {
      contract.contract_clauses.sort((a, b) => a.order_index - b.order_index);
    }

    return contract;
  }

  async create(
    dto: CreateContractDto,
    userId: string,
  ): Promise<Contract> {
    const contract = this.contractRepository.create({
      ...dto,
      created_by: userId,
      status: ContractStatus.DRAFT,
      current_version: 1,
    });

    const saved = await this.contractRepository.save(contract);

    // Create initial version snapshot
    await this.createVersionSnapshot(saved.id, userId, 'Initial draft');

    this.logger.log(`Contract created: ${saved.id} by user ${userId}`);

    return this.findById(saved.id);
  }

  async update(
    id: string,
    dto: UpdateContractDto,
  ): Promise<Contract> {
    const contract = await this.findById(id);

    if (dto.name !== undefined) contract.name = dto.name;
    if (dto.party_type !== undefined) contract.party_type = dto.party_type;

    await this.contractRepository.save(contract);

    return this.findById(id);
  }

  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    userId: string,
  ): Promise<Contract> {
    const contract = await this.findById(id);
    const oldStatus = contract.status;
    const newStatus = dto.status;

    // Validate status transitions
    this.validateStatusTransition(oldStatus, newStatus);

    contract.status = newStatus;

    // Handle special status actions
    if (newStatus === ContractStatus.APPROVED) {
      contract.approved_by = userId;
      contract.approved_at = new Date();
    }

    if (newStatus === ContractStatus.SENT_TO_CONTRACTOR) {
      contract.shared_at = new Date();
    }

    await this.contractRepository.save(contract);

    this.logger.log(
      `Contract ${id} status changed: ${oldStatus} -> ${newStatus} by ${userId}`,
    );

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    const contract = await this.findById(id);

    if (contract.status !== ContractStatus.DRAFT) {
      throw new BadRequestException('Only draft contracts can be deleted');
    }

    await this.contractRepository.remove(contract);
  }

  // ─── Clause Management ─────────────────────────────────────

  async addClause(
    contractId: string,
    dto: AddClauseDto,
  ): Promise<ContractClause> {
    const contract = await this.findById(contractId);

    // Get the next order index if not provided
    let orderIndex = dto.order_index;
    if (orderIndex === undefined) {
      const maxOrder = await this.contractClauseRepository
        .createQueryBuilder('cc')
        .select('MAX(cc.order_index)', 'max')
        .where('cc.contract_id = :contractId', { contractId })
        .getRawOne();
      orderIndex = (maxOrder?.max || 0) + 1;
    }

    const contractClause = this.contractClauseRepository.create({
      contract_id: contractId,
      clause_id: dto.clause_id,
      section_number: dto.section_number,
      order_index: orderIndex,
      customizations: dto.customizations,
    });

    return this.contractClauseRepository.save(contractClause);
  }

  async updateContractClause(
    contractId: string,
    contractClauseId: string,
    dto: UpdateClauseOrderDto,
  ): Promise<ContractClause> {
    const cc = await this.contractClauseRepository.findOne({
      where: { id: contractClauseId, contract_id: contractId },
    });

    if (!cc) {
      throw new NotFoundException('Contract clause not found');
    }

    if (dto.order_index !== undefined) cc.order_index = dto.order_index;
    if (dto.section_number !== undefined) cc.section_number = dto.section_number;
    if (dto.customizations !== undefined) cc.customizations = dto.customizations;

    return this.contractClauseRepository.save(cc);
  }

  async removeClause(
    contractId: string,
    contractClauseId: string,
  ): Promise<void> {
    const cc = await this.contractClauseRepository.findOne({
      where: { id: contractClauseId, contract_id: contractId },
    });

    if (!cc) {
      throw new NotFoundException('Contract clause not found');
    }

    await this.contractClauseRepository.remove(cc);
  }

  async reorderClauses(
    contractId: string,
    clauseOrder: { id: string; order_index: number }[],
  ): Promise<void> {
    for (const item of clauseOrder) {
      await this.contractClauseRepository.update(
        { id: item.id, contract_id: contractId },
        { order_index: item.order_index },
      );
    }
  }

  async getContractClauses(contractId: string): Promise<ContractClause[]> {
    return this.contractClauseRepository.find({
      where: { contract_id: contractId },
      relations: ['clause', 'clause.creator'],
      order: { order_index: 'ASC' },
    });
  }

  // ─── Version Management ────────────────────────────────────

  async createVersionSnapshot(
    contractId: string,
    userId: string,
    changeSummary?: string,
  ): Promise<ContractVersion> {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId },
      relations: ['contract_clauses', 'contract_clauses.clause'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    const snapshot = {
      name: contract.name,
      contract_type: contract.contract_type,
      status: contract.status,
      party_type: contract.party_type,
      clauses: contract.contract_clauses?.map((cc) => ({
        clause_id: cc.clause_id,
        clause_title: cc.clause?.title,
        clause_content: cc.clause?.content,
        section_number: cc.section_number,
        order_index: cc.order_index,
        customizations: cc.customizations,
      })) || [],
    };

    const version = this.contractVersionRepository.create({
      contract_id: contractId,
      version_number: contract.current_version,
      snapshot,
      change_summary: changeSummary,
      created_by: userId,
    });

    return this.contractVersionRepository.save(version);
  }

  async getVersions(contractId: string): Promise<ContractVersion[]> {
    return this.contractVersionRepository.find({
      where: { contract_id: contractId },
      relations: ['creator'],
      order: { version_number: 'DESC' },
    });
  }

  async getVersion(
    contractId: string,
    versionId: string,
  ): Promise<ContractVersion> {
    const version = await this.contractVersionRepository.findOne({
      where: { id: versionId, contract_id: contractId },
      relations: ['creator'],
    });

    if (!version) {
      throw new NotFoundException('Contract version not found');
    }

    return version;
  }

  async saveNewVersion(
    contractId: string,
    userId: string,
    changeSummary: string,
  ): Promise<ContractVersion> {
    const contract = await this.findById(contractId);

    contract.current_version += 1;
    await this.contractRepository.save(contract);

    return this.createVersionSnapshot(contractId, userId, changeSummary);
  }

  // ─── Comments ──────────────────────────────────────────────

  async addComment(
    contractId: string,
    dto: AddCommentDto,
    userId: string,
  ): Promise<ContractComment> {
    const contract = await this.findById(contractId);

    const comment = this.contractCommentRepository.create({
      contract_id: contractId,
      contract_clause_id: dto.contract_clause_id,
      user_id: userId,
      content: dto.content,
      parent_comment_id: dto.parent_comment_id,
    });

    return this.contractCommentRepository.save(comment);
  }

  async getComments(
    contractId: string,
    clauseId?: string,
  ): Promise<ContractComment[]> {
    const qb = this.contractCommentRepository
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.user', 'user')
      .leftJoinAndSelect('comment.replies', 'replies')
      .leftJoinAndSelect('replies.user', 'replyUser')
      .where('comment.contract_id = :contractId', { contractId })
      .andWhere('comment.parent_comment_id IS NULL'); // Only top-level

    if (clauseId) {
      qb.andWhere('comment.contract_clause_id = :clauseId', { clauseId });
    }

    qb.orderBy('comment.created_at', 'ASC');
    qb.addOrderBy('replies.created_at', 'ASC');

    return qb.getMany();
  }

  async resolveComment(
    contractId: string,
    commentId: string,
  ): Promise<ContractComment> {
    const comment = await this.contractCommentRepository.findOne({
      where: { id: commentId, contract_id: contractId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    comment.is_resolved = true;
    return this.contractCommentRepository.save(comment);
  }

  // ─── Contractor Responses ──────────────────────────────────

  async getContractorResponses(contractId: string): Promise<ContractorResponse[]> {
    return this.contractorResponseRepository.find({
      where: { contract_id: contractId },
      relations: ['party'],
      order: { created_at: 'DESC' },
    });
  }

  // ─── Status Transition Validation ─────────────────────────

  private validateStatusTransition(
    from: ContractStatus,
    to: ContractStatus,
  ): void {
    const allowedTransitions: Record<ContractStatus, ContractStatus[]> = {
      [ContractStatus.DRAFT]: [
        ContractStatus.PENDING_APPROVAL,
        ContractStatus.TERMINATED,
      ],
      [ContractStatus.PENDING_APPROVAL]: [
        ContractStatus.APPROVED,
        ContractStatus.CHANGES_REQUESTED,
        ContractStatus.DRAFT,
      ],
      [ContractStatus.APPROVED]: [
        ContractStatus.PENDING_TENDERING,
        ContractStatus.SENT_TO_CONTRACTOR,
      ],
      [ContractStatus.PENDING_TENDERING]: [
        ContractStatus.SENT_TO_CONTRACTOR,
        ContractStatus.DRAFT,
      ],
      [ContractStatus.SENT_TO_CONTRACTOR]: [
        ContractStatus.CONTRACTOR_REVIEWING,
      ],
      [ContractStatus.CONTRACTOR_REVIEWING]: [
        ContractStatus.PENDING_FINAL_APPROVAL,
        ContractStatus.CHANGES_REQUESTED,
      ],
      [ContractStatus.PENDING_FINAL_APPROVAL]: [
        ContractStatus.ACTIVE,
        ContractStatus.CHANGES_REQUESTED,
        ContractStatus.RISK_ESCALATION_PENDING,
      ],
      [ContractStatus.CHANGES_REQUESTED]: [
        ContractStatus.DRAFT,
        ContractStatus.PENDING_APPROVAL,
      ],
      [ContractStatus.RISK_ESCALATION_PENDING]: [
        ContractStatus.ACTIVE,
        ContractStatus.CHANGES_REQUESTED,
        ContractStatus.TERMINATED,
      ],
      [ContractStatus.ACTIVE]: [
        ContractStatus.COMPLETED,
        ContractStatus.TERMINATED,
      ],
      [ContractStatus.COMPLETED]: [],
      [ContractStatus.TERMINATED]: [],
    };

    const allowed = allowedTransitions[from] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot transition from ${from} to ${to}`,
      );
    }
  }
}
