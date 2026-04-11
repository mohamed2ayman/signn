import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan, Not } from 'typeorm';
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
  ) {}

  async create(
    dto: CreateNoticeDto,
    userId: string,
    orgId: string,
  ): Promise<Notice> {
    const contract = await this.contractRepo.findOne({
      where: { id: dto.contract_id },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

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

  async findAllByContract(contractId: string): Promise<Notice[]> {
    const contract = await this.contractRepo.findOne({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ForbiddenException(
        'Notices can only be viewed for ACTIVE contracts',
      );
    }

    await this.checkOverdueNotices(contractId);

    return this.noticeRepo.find({
      where: { contract_id: contractId },
      relations: ['submitter'],
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string): Promise<Notice> {
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
      throw new NotFoundException('Notice not found');
    }

    return notice;
  }

  async acknowledge(id: string, userId: string): Promise<Notice> {
    const notice = await this.findById(id);
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
  ): Promise<NoticeResponse> {
    const notice = await this.findById(id);
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
  ): Promise<Notice> {
    const notice = await this.findById(id);
    const previousStatus = notice.status;

    const terminalStatuses: NoticeStatus[] = [
      NoticeStatus.CLOSED,
      NoticeStatus.WITHDRAWN,
    ];

    if (terminalStatuses.includes(notice.status)) {
      throw new BadRequestException(
        `Cannot transition from terminal status ${notice.status}`,
      );
    }

    notice.status = dto.status;

    const saved = await this.noticeRepo.save(notice);

    await this.logStatusChange(id, userId, previousStatus, dto.status, dto.note);

    return saved;
  }

  async withdraw(id: string, userId: string): Promise<Notice> {
    const notice = await this.findById(id);
    const previousStatus = notice.status;

    notice.status = NoticeStatus.WITHDRAWN;

    const saved = await this.noticeRepo.save(notice);

    await this.logStatusChange(
      id,
      userId,
      previousStatus,
      NoticeStatus.WITHDRAWN,
    );

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
      NoticeStatus.WITHDRAWN,
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
