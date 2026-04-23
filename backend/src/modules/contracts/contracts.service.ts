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
  ContractVersionEventType,
  ContractComment,
  ContractorResponse,
  User,
  ContractApprover,
  ApproverStatus,
} from '../../database/entities';
import { diffWordsWithSpace } from 'diff';
import {
  CreateContractDto,
  UpdateContractDto,
  AddClauseDto,
  UpdateClauseOrderDto,
  AddCommentDto,
  UpdateStatusDto,
} from './dto';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';
import { ContractTemplatesService, isStandardForm, getLicenseOrg } from '../contract-templates/contract-templates.service';
import { EmailService } from '../notifications/email.service';

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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ContractApprover)
    private readonly contractApproverRepository: Repository<ContractApprover>,
    private readonly collaborationGateway: CollaborationGateway,
    private readonly contractTemplatesService: ContractTemplatesService,
    private readonly emailService: EmailService,
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
    // Enforce license acknowledgment for standard forms
    if (isStandardForm(dto.contract_type)) {
      if (!dto.license_acknowledged) {
        throw new BadRequestException(
          'License acknowledgment is required for standard form contracts',
        );
      }
    }

    const contract = this.contractRepository.create({
      project_id: dto.project_id,
      name: dto.name,
      contract_type: dto.contract_type,
      party_type: dto.party_type,
      license_acknowledged: dto.license_acknowledged || false,
      license_organization: isStandardForm(dto.contract_type)
        ? getLicenseOrg(dto.contract_type)
        : null,
      created_by: userId,
      status: ContractStatus.DRAFT,
      current_version: 1,
    });

    const saved = await this.contractRepository.save(contract);

    // Auto-instantiate template for standard form contracts
    if (isStandardForm(dto.contract_type)) {
      try {
        await this.contractTemplatesService.instantiateTemplate(
          saved.id,
          dto.contract_type,
        );
        this.logger.log(
          `Template instantiated for contract ${saved.id} (${dto.contract_type})`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Template instantiation failed for ${dto.contract_type}: ${err?.message}. Contract created without clauses.`,
        );
      }
    }

    // Create initial version snapshot
    await this.createVersionSnapshot(saved.id, userId, undefined, {
      eventType: ContractVersionEventType.CREATED,
    });

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

    // Create version snapshot for status change
    const statusEventMap: Partial<Record<ContractStatus, ContractVersionEventType>> = {
      [ContractStatus.PENDING_APPROVAL]: ContractVersionEventType.SUBMITTED_FOR_APPROVAL,
      [ContractStatus.APPROVED]: ContractVersionEventType.APPROVED,
      [ContractStatus.CHANGES_REQUESTED]: ContractVersionEventType.CHANGES_REQUESTED,
      [ContractStatus.SENT_TO_CONTRACTOR]: ContractVersionEventType.SHARED_WITH_COUNTERPARTY,
      [ContractStatus.CONTRACTOR_REVIEWING]: ContractVersionEventType.COUNTERPARTY_RESPONSE_RECEIVED,
      [ContractStatus.PENDING_FINAL_APPROVAL]: ContractVersionEventType.SUBMITTED_FOR_REVIEW,
      [ContractStatus.RISK_ESCALATION_PENDING]: ContractVersionEventType.ESCALATED,
      [ContractStatus.ACTIVE]: ContractVersionEventType.EXECUTED,
    };
    const mappedEvent = statusEventMap[newStatus];
    if (mappedEvent) {
      try {
        await this.createVersionSnapshot(id, userId, undefined, {
          eventType: mappedEvent,
          metadata: { oldStatus, newStatus },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to create version snapshot for status change: ${err?.message}`);
      }
    }

    // Emit real-time event
    this.collaborationGateway.emitStatusChanged(id, {
      contractId: id,
      oldStatus,
      newStatus,
      updatedBy: userId,
    });

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    const contract = await this.findById(id);

    if (contract.status !== ContractStatus.DRAFT) {
      throw new BadRequestException('Only draft contracts can be deleted');
    }

    await this.contractRepository.remove(contract);
  }

  // ─── Party Names ────────────────────────────────────────────

  async updateParties(
    id: string,
    data: { party_first_name?: string | null; party_second_name?: string | null },
  ): Promise<Contract> {
    const contract = await this.findById(id);

    if (data.party_first_name !== undefined) {
      contract.party_first_name = data.party_first_name || null;
    }
    if (data.party_second_name !== undefined) {
      contract.party_second_name = data.party_second_name || null;
    }

    await this.contractRepository.save(contract);
    return this.findById(id);
  }

  // ─── Clause Management ─────────────────────────────────────

  async addClause(
    contractId: string,
    dto: AddClauseDto,
    userId?: string,
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

    const saved = await this.contractClauseRepository.save(contractClause);

    // Emit real-time event
    this.collaborationGateway.emitClauseAdded(contractId, {
      contractId,
      clause: saved,
    });

    if (userId) {
      try {
        await this.createVersionSnapshot(contractId, userId, undefined, {
          eventType: ContractVersionEventType.EDITED,
          metadata: { action: 'clause_added', contract_clause_id: saved.id },
        });
      } catch (err: any) {
        this.logger.warn(`Version snapshot failed (addClause): ${err?.message}`);
      }
    }

    return saved;
  }

  async updateContractClause(
    contractId: string,
    contractClauseId: string,
    dto: UpdateClauseOrderDto,
    userId?: string,
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

    const saved = await this.contractClauseRepository.save(cc);

    // Emit real-time event
    this.collaborationGateway.emitClauseUpdated(contractId, {
      contractId,
      clause: saved,
    });

    if (userId) {
      try {
        await this.createVersionSnapshot(contractId, userId, undefined, {
          eventType: ContractVersionEventType.EDITED,
          metadata: { action: 'clause_updated', contract_clause_id: saved.id },
        });
      } catch (err: any) {
        this.logger.warn(`Version snapshot failed (updateContractClause): ${err?.message}`);
      }
    }

    return saved;
  }

  async removeClause(
    contractId: string,
    contractClauseId: string,
    userId?: string,
  ): Promise<void> {
    const cc = await this.contractClauseRepository.findOne({
      where: { id: contractClauseId, contract_id: contractId },
    });

    if (!cc) {
      throw new NotFoundException('Contract clause not found');
    }

    await this.contractClauseRepository.remove(cc);

    // Emit real-time event
    this.collaborationGateway.emitClauseRemoved(contractId, {
      contractId,
      clauseId: contractClauseId,
    });

    if (userId) {
      try {
        await this.createVersionSnapshot(contractId, userId, undefined, {
          eventType: ContractVersionEventType.EDITED,
          metadata: { action: 'clause_removed', contract_clause_id: contractClauseId },
        });
      } catch (err: any) {
        this.logger.warn(`Version snapshot failed (removeClause): ${err?.message}`);
      }
    }
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

  /**
   * Resolve a user's display role from their job_title (party-neutral).
   */
  private async resolveUserRole(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      return user?.job_title || null;
    } catch {
      return null;
    }
  }

  /**
   * Construct an event description dynamically from actor + counterparty roles.
   * Never hardcodes party names — always uses runtime role data.
   */
  private buildEventDescription(
    eventType: ContractVersionEventType,
    triggeredByRole: string | null,
    counterpartyRole: string | null,
  ): string {
    const actor = triggeredByRole || 'a team member';
    const target = counterpartyRole || 'counterparty';

    switch (eventType) {
      case ContractVersionEventType.CREATED:
        return `Contract created by ${actor}`;
      case ContractVersionEventType.EDITED:
        return `Contract edited by ${actor}`;
      case ContractVersionEventType.RISK_ANALYZED:
        return `Risk analysis completed by ${actor}`;
      case ContractVersionEventType.SUBMITTED_FOR_APPROVAL:
        return `Contract submitted for approval by ${actor}`;
      case ContractVersionEventType.APPROVED:
        return `Contract approved by ${actor}`;
      case ContractVersionEventType.CHANGES_REQUESTED:
        return `Changes requested by ${actor}`;
      case ContractVersionEventType.SHARED_WITH_COUNTERPARTY:
        return `Contract shared with ${target} by ${actor}`;
      case ContractVersionEventType.COUNTERPARTY_RESPONSE_RECEIVED:
        return `Response received from ${target}`;
      case ContractVersionEventType.SUBMITTED_FOR_REVIEW:
        return `Contract submitted for review to ${target} by ${actor}`;
      case ContractVersionEventType.REVIEWED_AND_RETURNED:
        return `Contract reviewed and returned by ${actor}`;
      case ContractVersionEventType.SUBMITTED_TO_COUNTERPARTY:
        return `Contract submitted to ${target} by ${actor}`;
      case ContractVersionEventType.CERTIFIED_BY_COUNTERPARTY:
        return `Contract certified by ${actor}`;
      case ContractVersionEventType.FORWARDED_TO_COUNTERPARTY:
        return `Contract forwarded to ${target} by ${actor}`;
      case ContractVersionEventType.NEGOTIATION_ROUND:
        return `New negotiation round started by ${actor}`;
      case ContractVersionEventType.ESCALATED:
        return `Contract escalated by ${actor}`;
      case ContractVersionEventType.EXECUTED:
        return `Contract executed`;
      case ContractVersionEventType.AMENDMENT_ADDED:
        return `Amendment added by ${actor}`;
      default:
        return `Contract updated by ${actor}`;
    }
  }

  /**
   * Determine whether a given event type counts as a milestone.
   */
  private isMilestoneEvent(eventType: ContractVersionEventType): boolean {
    return [
      ContractVersionEventType.CREATED,
      ContractVersionEventType.RISK_ANALYZED,
      ContractVersionEventType.SUBMITTED_FOR_APPROVAL,
      ContractVersionEventType.APPROVED,
      ContractVersionEventType.CHANGES_REQUESTED,
      ContractVersionEventType.SHARED_WITH_COUNTERPARTY,
      ContractVersionEventType.COUNTERPARTY_RESPONSE_RECEIVED,
      ContractVersionEventType.SUBMITTED_FOR_REVIEW,
      ContractVersionEventType.REVIEWED_AND_RETURNED,
      ContractVersionEventType.SUBMITTED_TO_COUNTERPARTY,
      ContractVersionEventType.CERTIFIED_BY_COUNTERPARTY,
      ContractVersionEventType.FORWARDED_TO_COUNTERPARTY,
      ContractVersionEventType.ESCALATED,
      ContractVersionEventType.EXECUTED,
      ContractVersionEventType.AMENDMENT_ADDED,
    ].includes(eventType);
  }

  /**
   * Create a new contract version snapshot for any event.
   * This is the canonical version-creation entry point.
   */
  async createVersionSnapshot(
    contractId: string,
    userId: string,
    changeSummary?: string,
    options?: {
      eventType?: ContractVersionEventType;
      counterpartyRole?: string | null;
      metadata?: Record<string, unknown>;
      bumpVersionNumber?: boolean;
    },
  ): Promise<ContractVersion> {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId },
      relations: ['contract_clauses', 'contract_clauses.clause'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Bump version number for every new event-driven snapshot.
    if (options?.bumpVersionNumber !== false) {
      // Find the highest existing version number for this contract
      const last = await this.contractVersionRepository.findOne({
        where: { contract_id: contractId },
        order: { version_number: 'DESC' },
      });
      const nextVersion = (last?.version_number || 0) + 1;
      contract.current_version = nextVersion;
      await this.contractRepository.save(contract);
    }

    const versionNumber = contract.current_version;

    const clauses = (contract.contract_clauses || [])
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((cc) => ({
        contract_clause_id: cc.id,
        clause_id: cc.clause_id,
        clause_title: cc.clause?.title || '',
        clause_content: cc.clause?.content || '',
        section_number: cc.section_number,
        order_index: cc.order_index,
        customizations: cc.customizations,
      }));

    const snapshot = {
      name: contract.name,
      contract_type: contract.contract_type,
      status: contract.status,
      party_type: contract.party_type,
      clauses,
    };

    const eventType = options?.eventType || ContractVersionEventType.EDITED;
    const triggeredByRole = await this.resolveUserRole(userId);
    const counterpartyRole = options?.counterpartyRole || null;
    const eventDescription =
      changeSummary ||
      this.buildEventDescription(eventType, triggeredByRole, counterpartyRole);

    const version = this.contractVersionRepository.create({
      contract_id: contractId,
      version_number: versionNumber,
      version_label: `V${versionNumber}`,
      event_type: eventType,
      event_description: eventDescription,
      triggered_by: userId,
      triggered_by_role: triggeredByRole,
      counterparty_role: counterpartyRole,
      contract_status_at_version: contract.status,
      snapshot,
      clause_snapshot: { clauses },
      metadata: options?.metadata || null,
      is_milestone: this.isMilestoneEvent(eventType),
      change_summary: eventDescription,
      created_by: userId,
    });

    return this.contractVersionRepository.save(version);
  }

  async getVersions(contractId: string): Promise<ContractVersion[]> {
    return this.contractVersionRepository.find({
      where: { contract_id: contractId },
      relations: ['creator', 'triggered_by_user'],
      order: { version_number: 'ASC' },
    });
  }

  async getMilestoneVersions(contractId: string): Promise<ContractVersion[]> {
    return this.contractVersionRepository.find({
      where: { contract_id: contractId, is_milestone: true },
      relations: ['creator', 'triggered_by_user'],
      order: { version_number: 'ASC' },
    });
  }

  async getVersion(
    contractId: string,
    versionId: string,
  ): Promise<ContractVersion> {
    const version = await this.contractVersionRepository.findOne({
      where: { id: versionId, contract_id: contractId },
      relations: ['creator', 'triggered_by_user'],
    });

    if (!version) {
      throw new NotFoundException('Contract version not found');
    }

    return version;
  }

  /**
   * Compute a structured diff between two versions of a contract.
   * Word-level diff is computed per clause; clauses are matched by clause_id.
   */
  async compareVersions(
    contractId: string,
    versionAId: string,
    versionBId: string,
  ): Promise<{
    versionA: ContractVersion;
    versionB: ContractVersion;
    summary: { added: number; removed: number; modified: number; unchanged: number };
    changes: Array<{
      clauseId: string;
      clauseNumber: string | null;
      clauseTitle: string;
      changeType: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';
      originalText: string | null;
      newText: string | null;
      wordLevelDiff:
        | Array<{ value: string; added?: boolean; removed?: boolean }>
        | null;
    }>;
  }> {
    const versionA = await this.getVersion(contractId, versionAId);
    const versionB = await this.getVersion(contractId, versionBId);

    type SnapClause = {
      contract_clause_id?: string;
      clause_id: string;
      clause_title: string;
      clause_content: string;
      section_number: string | null;
    };

    const snapA = (versionA.snapshot as any)?.clauses as SnapClause[] | undefined;
    const snapB = (versionB.snapshot as any)?.clauses as SnapClause[] | undefined;
    const clausesA: SnapClause[] = Array.isArray(snapA) ? snapA : [];
    const clausesB: SnapClause[] = Array.isArray(snapB) ? snapB : [];

    const aMap = new Map(clausesA.map((c) => [c.clause_id, c]));
    const bMap = new Map(clausesB.map((c) => [c.clause_id, c]));
    const allIds = new Set<string>([...aMap.keys(), ...bMap.keys()]);

    const changes: Array<any> = [];
    let added = 0,
      removed = 0,
      modified = 0,
      unchanged = 0;

    for (const id of allIds) {
      const a = aMap.get(id);
      const b = bMap.get(id);

      if (a && !b) {
        removed++;
        changes.push({
          clauseId: id,
          clauseNumber: a.section_number,
          clauseTitle: a.clause_title,
          changeType: 'REMOVED',
          originalText: a.clause_content,
          newText: null,
          wordLevelDiff: null,
        });
      } else if (!a && b) {
        added++;
        changes.push({
          clauseId: id,
          clauseNumber: b.section_number,
          clauseTitle: b.clause_title,
          changeType: 'ADDED',
          originalText: null,
          newText: b.clause_content,
          wordLevelDiff: null,
        });
      } else if (a && b) {
        const aText = a.clause_content || '';
        const bText = b.clause_content || '';
        if (aText === bText && a.clause_title === b.clause_title) {
          unchanged++;
          changes.push({
            clauseId: id,
            clauseNumber: b.section_number,
            clauseTitle: b.clause_title,
            changeType: 'UNCHANGED',
            originalText: aText,
            newText: bText,
            wordLevelDiff: null,
          });
        } else {
          modified++;
          const wordDiff = diffWordsWithSpace(aText, bText).map((p) => ({
            value: p.value,
            added: p.added,
            removed: p.removed,
          }));
          changes.push({
            clauseId: id,
            clauseNumber: b.section_number,
            clauseTitle: b.clause_title,
            changeType: 'MODIFIED',
            originalText: aText,
            newText: bText,
            wordLevelDiff: wordDiff,
          });
        }
      }
    }

    // Sort: changed first, then unchanged
    const order: Record<string, number> = { ADDED: 0, REMOVED: 1, MODIFIED: 2, UNCHANGED: 3 };
    changes.sort((x, y) => order[x.changeType] - order[y.changeType]);

    return {
      versionA,
      versionB,
      summary: { added, removed, modified, unchanged },
      changes,
    };
  }

  async saveNewVersion(
    contractId: string,
    userId: string,
    changeSummary: string,
  ): Promise<ContractVersion> {
    return this.createVersionSnapshot(contractId, userId, changeSummary, {
      eventType: ContractVersionEventType.EDITED,
    });
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

    const saved = await this.contractCommentRepository.save(comment);

    // Emit real-time event
    this.collaborationGateway.emitCommentAdded(contractId, {
      contractId,
      comment: saved,
    });

    return saved;
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
    const saved = await this.contractCommentRepository.save(comment);

    // Emit real-time event
    this.collaborationGateway.emitCommentResolved(contractId, {
      contractId,
      commentId,
    });

    return saved;
  }

  async updateComment(
    contractId: string,
    commentId: string,
    userId: string,
    content: string,
  ): Promise<ContractComment> {
    const comment = await this.contractCommentRepository.findOne({
      where: { id: commentId, contract_id: contractId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.user_id !== userId) {
      throw new ForbiddenException('Only the comment author can edit this comment');
    }

    comment.content = content;
    return this.contractCommentRepository.save(comment);
  }

  async deleteComment(
    contractId: string,
    commentId: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    const comment = await this.contractCommentRepository.findOne({
      where: { id: commentId, contract_id: contractId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const adminRoles = ['SYSTEM_ADMIN', 'OWNER_ADMIN', 'CONTRACTOR_ADMIN'];
    const isAdmin = adminRoles.includes(userRole);
    const isAuthor = comment.user_id === userId;

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('You do not have permission to delete this comment');
    }

    await this.contractCommentRepository.remove(comment);
  }

  // ─── Contractor Responses ──────────────────────────────────

  async getContractorResponses(contractId: string): Promise<ContractorResponse[]> {
    return this.contractorResponseRepository.find({
      where: { contract_id: contractId },
      relations: ['party'],
      order: { created_at: 'DESC' },
    });
  }

  // ─── Approval Workflow ─────────────────────────────────────

  /**
   * Assign approvers and submit the contract for approval.
   * Transitions status DRAFT/CHANGES_REQUESTED → PENDING_APPROVAL.
   * Sends email notifications to each assigned approver.
   */
  async requestApproval(
    contractId: string,
    requesterId: string,
    approverIds: string[],
  ): Promise<ContractApprover[]> {
    if (!approverIds || approverIds.length === 0) {
      throw new BadRequestException('At least one approver must be selected');
    }

    const contract = await this.findById(contractId);

    if (
      contract.status !== ContractStatus.DRAFT &&
      contract.status !== ContractStatus.CHANGES_REQUESTED
    ) {
      throw new BadRequestException(
        'Contract must be in DRAFT or CHANGES_REQUESTED status to request approval',
      );
    }

    // Remove any previous PENDING approver records (re-submission after changes)
    await this.contractApproverRepository.delete({ contract_id: contractId });

    // Create a new approver record for each selected user
    const approvers: ContractApprover[] = [];
    for (const userId of approverIds) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) continue;

      const record = this.contractApproverRepository.create({
        contract_id: contractId,
        user_id: userId,
        status: ApproverStatus.PENDING,
      });
      const saved = await this.contractApproverRepository.save(record);
      approvers.push(saved);
    }

    // Transition status to PENDING_APPROVAL
    contract.status = ContractStatus.PENDING_APPROVAL;
    await this.contractRepository.save(contract);

    // Create version snapshot
    try {
      await this.createVersionSnapshot(contractId, requesterId, undefined, {
        eventType: ContractVersionEventType.SUBMITTED_FOR_APPROVAL,
        metadata: { approver_ids: approverIds },
      });
    } catch (err: any) {
      this.logger.warn(`Version snapshot failed (requestApproval): ${err?.message}`);
    }

    // Emit real-time status change
    this.collaborationGateway.emitStatusChanged(contractId, {
      contractId,
      oldStatus: ContractStatus.DRAFT,
      newStatus: ContractStatus.PENDING_APPROVAL,
      updatedBy: requesterId,
    });

    // Fetch requester info for emails
    const requester = await this.userRepository.findOne({ where: { id: requesterId } });
    const requesterName = requester
      ? `${requester.first_name} ${requester.last_name}`.trim()
      : 'A team member';

    // Send email notifications to all assigned approvers
    for (const approver of approvers) {
      const approverUser = await this.userRepository.findOne({
        where: { id: approver.user_id },
      });
      if (!approverUser) continue;

      await this.emailService.sendContractApprovalRequest(
        approverUser.email,
        contract.name,
        contract.project?.name || 'your project',
        requesterName,
        contractId,
      );
    }

    return this.getApprovers(contractId);
  }

  /**
   * An assigned approver submits their decision (APPROVED / REJECTED).
   * If all approvers approve → contract moves to APPROVED.
   * If any approver rejects → contract returns to DRAFT with status CHANGES_REQUESTED.
   */
  async reviewApproval(
    contractId: string,
    userId: string,
    decision: ApproverStatus.APPROVED | ApproverStatus.REJECTED,
    comment?: string,
  ): Promise<ContractApprover[]> {
    const contract = await this.findById(contractId);

    if (contract.status !== ContractStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Contract is not currently pending approval');
    }

    // Find this user's approver record
    const record = await this.contractApproverRepository.findOne({
      where: { contract_id: contractId, user_id: userId },
    });

    if (!record) {
      throw new ForbiddenException('You are not assigned as an approver for this contract');
    }

    if (record.status !== ApproverStatus.PENDING) {
      throw new BadRequestException('You have already submitted your decision');
    }

    // Record the decision
    record.status = decision;
    record.comment = comment || null;
    record.approved_at = new Date();
    await this.contractApproverRepository.save(record);

    // Check overall outcome
    const allRecords = await this.contractApproverRepository.find({
      where: { contract_id: contractId },
    });

    const anyRejected = allRecords.some((r) => r.status === ApproverStatus.REJECTED);
    const allApproved = allRecords.every((r) => r.status === ApproverStatus.APPROVED);

    if (anyRejected) {
      // Return to DRAFT/CHANGES_REQUESTED
      contract.status = ContractStatus.CHANGES_REQUESTED;
      await this.contractRepository.save(contract);

      try {
        await this.createVersionSnapshot(contractId, userId, comment, {
          eventType: ContractVersionEventType.CHANGES_REQUESTED,
          metadata: { rejected_by: userId, comment },
        });
      } catch (err: any) {
        this.logger.warn(`Version snapshot failed (reviewApproval REJECTED): ${err?.message}`);
      }

      this.collaborationGateway.emitStatusChanged(contractId, {
        contractId,
        oldStatus: ContractStatus.PENDING_APPROVAL,
        newStatus: ContractStatus.CHANGES_REQUESTED,
        updatedBy: userId,
      });
    } else if (allApproved) {
      // All approvers have approved — move to APPROVED
      contract.status = ContractStatus.APPROVED;
      contract.approved_by = userId;
      contract.approved_at = new Date();
      await this.contractRepository.save(contract);

      try {
        await this.createVersionSnapshot(contractId, userId, undefined, {
          eventType: ContractVersionEventType.APPROVED,
          metadata: { approved_by: userId },
        });
      } catch (err: any) {
        this.logger.warn(`Version snapshot failed (reviewApproval APPROVED): ${err?.message}`);
      }

      this.collaborationGateway.emitStatusChanged(contractId, {
        contractId,
        oldStatus: ContractStatus.PENDING_APPROVAL,
        newStatus: ContractStatus.APPROVED,
        updatedBy: userId,
      });
    }

    return this.getApprovers(contractId);
  }

  /**
   * Get all approver records for a contract, with user details.
   */
  async getApprovers(contractId: string): Promise<ContractApprover[]> {
    return this.contractApproverRepository.find({
      where: { contract_id: contractId },
      relations: ['user'],
      order: { assigned_at: 'ASC' },
    });
  }

  /**
   * Get all contracts currently pending the given user's approval
   * across all projects in their organisation.
   */
  async getPendingApprovalsForUser(
    userId: string,
    orgId: string,
  ): Promise<ContractApprover[]> {
    return this.contractApproverRepository
      .createQueryBuilder('ca')
      .leftJoinAndSelect('ca.contract', 'contract')
      .leftJoinAndSelect('contract.project', 'project')
      .leftJoinAndSelect('contract.creator', 'creator')
      .where('ca.user_id = :userId', { userId })
      .andWhere('ca.status = :status', { status: ApproverStatus.PENDING })
      .andWhere('contract.status = :contractStatus', {
        contractStatus: ContractStatus.PENDING_APPROVAL,
      })
      .andWhere('project.organization_id = :orgId', { orgId })
      .orderBy('ca.assigned_at', 'DESC')
      .getMany();
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
