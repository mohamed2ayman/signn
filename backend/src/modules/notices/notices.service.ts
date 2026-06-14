import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Contract, ContractStatus } from '../../database/entities';
import {
  Notice,
  NoticeDocument,
  NoticeResponse,
  NoticeStatusLog,
  NoticeStatus,
} from '../../database/entities/notice.entity';
import {
  CreateNoticeDto,
  UpdateNoticeStatusDto,
  CreateNoticeResponseDto,
} from './dto';
import { ContractAccessService } from '../contracts/services/contract-access.service';
// Option B — S2e: NoticesService loads its per-contract LIST and by-id surfaces
// through NoticeScopedRepository (the data-layer tenancy chokepoint, layer 2),
// UNDER the independent #57 / Tier 3 findInOrg walls (layer 1).
import { NoticeScopedRepository } from '../scoped-repository/notice-scoped.repository';

@Injectable()
export class NoticesService {
  constructor(
    @InjectRepository(Notice)
    private readonly noticeRepo: Repository<Notice>,

    @InjectRepository(NoticeDocument)
    private readonly noticeDocumentRepo: Repository<NoticeDocument>,

    @InjectRepository(NoticeResponse)
    private readonly noticeResponseRepo: Repository<NoticeResponse>,

    @InjectRepository(NoticeStatusLog)
    private readonly noticeStatusLogRepo: Repository<NoticeStatusLog>,

    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,

    private readonly contractAccess: ContractAccessService,

    private readonly noticeScoped: NoticeScopedRepository,
  ) {}

  async create(
    dto: CreateNoticeDto,
    userId: string,
    orgId: string,
  ): Promise<Notice> {
    // Tenant-isolation Tier 3 wall — cross-org caller gets 404 (NOT
    // 403) before any DB write or status gate runs.
    const contract = await this.contractAccess.findInOrg(dto.contract_id, orgId);

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Notices can only be created for ACTIVE contracts',
      );
    }

    const existingCount = await this.noticeRepo.count({
      where: { contract_id: dto.contract_id },
    });

    const sequenceNumber = existingCount + 1;
    const noticeReference = `NTC-${String(sequenceNumber).padStart(3, '0')}`;

    const notice = this.noticeRepo.create({
      contract_id: dto.contract_id,
      org_id: orgId,
      submitted_by: userId,
      notice_reference: noticeReference,
      notice_type: dto.notice_type,
      title: dto.title,
      description: dto.description,
      event_date: dto.event_date as unknown as Date,
      response_required: dto.response_required ?? false,
      response_deadline: dto.response_deadline
        ? (dto.response_deadline as unknown as Date)
        : undefined,
      contract_clause_references: dto.contract_clause_references,
      status: NoticeStatus.DRAFT,
    });

    return this.noticeRepo.save(notice);
  }

  async findAllByContract(contractId: string, orgId: string): Promise<Notice[]> {
    // Tenant-isolation Tier 3 wall — cross-org caller gets 404 before
    // the status gate or overdue scan runs.
    const contract = await this.contractAccess.findInOrg(contractId, orgId);

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Notices can only be viewed for ACTIVE contracts',
      );
    }

    await this.checkOverdueNotices(contractId);

    // SCOPED LIST (tenancy — Option B S2e, layer 2): the org-safe row set comes
    // from the scoped chokepoint, which independently re-applies the canonical
    // notice→contract→project→org join. Cross-tenant rows are excluded even if
    // the wall above were bypassed. relations/order are single-level, so this is
    // a behavior-preserving drop-in for the bare find (no two-step needed).
    return this.noticeScoped.scopedFind(
      { contract_id: contractId },
      orgId,
      { relations: ['submitter'], order: { created_at: 'DESC' } },
    );
  }

  async findById(id: string, orgId: string): Promise<Notice> {
    // SCOPED LOAD (tenancy — Option B S2e, layer 2): cross-org denied at the
    // data layer BEFORE any nested relation is hydrated.
    const scoped = await this.noticeScoped.scopedFindByIdOrThrow(id, orgId);

    // WALL (persona — #57 S0-part-2, layer 1): STAYS as defense-in-depth, keyed
    // on the scoped row's OWN contract_id (never a URL-supplied contractId).
    // This is the shared loader, so acknowledge/respond/updateStatus inherit
    // both layers.
    await this.contractAccess.findInOrg(scoped.contract_id, orgId);

    // HYDRATION on the tenancy-validated id — the nested relations
    // (documents.uploader, responses.responder, status_logs.changer) exceed the
    // scoped base's single-level relation support; the two-step keeps the base
    // minimal instead of growing it.
    const notice = await this.noticeRepo.findOne({
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

    if (!notice) {
      // Row vanished between the scoped load and the hydrate (race) — same
      // no-existence-leak 404.
      throw new NotFoundException('Notice not found');
    }

    return notice;
  }

  async acknowledge(id: string, userId: string, orgId: string): Promise<Notice> {
    const notice = await this.findById(id, orgId);
    const previousStatus = notice.status;

    notice.status = NoticeStatus.ACKNOWLEDGED;
    notice.acknowledged_at = new Date();

    const saved = await this.noticeRepo.save(notice);

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      NoticeStatus.ACKNOWLEDGED,
    );

    return saved;
  }

  async respond(
    id: string,
    dto: CreateNoticeResponseDto,
    userId: string,
    orgId: string,
  ): Promise<NoticeResponse> {
    const notice = await this.findById(id, orgId);
    const previousStatus = notice.status;

    const response = this.noticeResponseRepo.create({
      notice_id: id,
      responded_by: userId,
      response_type: dto.response_type,
      response_content: dto.response_content,
    });

    const savedResponse = await this.noticeResponseRepo.save(response);

    notice.status = NoticeStatus.RESPONDED;
    await this.noticeRepo.save(notice);

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      NoticeStatus.RESPONDED,
    );

    return savedResponse;
  }

  async updateStatus(
    id: string,
    dto: UpdateNoticeStatusDto,
    userId: string,
    orgId: string,
  ): Promise<Notice> {
    const notice = await this.findById(id, orgId);
    const previousStatus = notice.status;

    if (notice.status === NoticeStatus.CLOSED) {
      throw new BadRequestException(
        `Cannot transition from terminal status ${notice.status}`,
      );
    }

    notice.status = dto.status;

    const saved = await this.noticeRepo.save(notice);

    await this.logStatusChange(id, userId, previousStatus, dto.status, dto.note);

    return saved;
  }

  private async logStatusChange(
    noticeId: string,
    userId: string,
    previousStatus: string,
    newStatus: string,
    note?: string,
  ): Promise<NoticeStatusLog> {
    const log = this.noticeStatusLogRepo.create({
      notice_id: noticeId,
      changed_by: userId,
      previous_status: previousStatus,
      new_status: newStatus,
      note,
    });

    return this.noticeStatusLogRepo.save(log);
  }

  private async checkOverdueNotices(contractId: string): Promise<void> {
    const terminalStatuses = [
      NoticeStatus.RESPONDED,
      NoticeStatus.CLOSED,
      NoticeStatus.OVERDUE,
    ];

    const overdueNotices = await this.noticeRepo.find({
      where: {
        contract_id: contractId,
        response_required: true,
        status: Not(In(terminalStatuses)),
      },
    });

    const now = new Date();

    for (const notice of overdueNotices) {
      if (notice.response_deadline && new Date(notice.response_deadline) < now) {
        const previousStatus = notice.status;
        notice.status = NoticeStatus.OVERDUE;
        await this.noticeRepo.save(notice);
        await this.logStatusChange(
          notice.id,
          notice.submitted_by,
          previousStatus,
          NoticeStatus.OVERDUE,
          'Automatically marked as overdue — response deadline has passed',
        );
      }
    }
  }
}
