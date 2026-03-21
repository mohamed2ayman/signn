import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ContractShare, Contract } from '../../database/entities';

@Injectable()
export class ContractSharingService {
  private readonly logger = new Logger(ContractSharingService.name);

  constructor(
    @InjectRepository(ContractShare)
    private readonly shareRepository: Repository<ContractShare>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
  ) {}

  async createShare(params: {
    contractId: string;
    sharedBy: string;
    sharedWithEmail: string;
    permission: string;
    expiresInDays?: number;
  }): Promise<ContractShare> {
    const contract = await this.contractRepository.findOne({
      where: { id: params.contractId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const share = this.shareRepository.create({
      contract_id: params.contractId,
      shared_by: params.sharedBy,
      shared_with_email: params.sharedWithEmail,
      permission: params.permission || 'view',
      token,
      expires_at: expiresAt,
      is_active: true,
    });

    const saved = await this.shareRepository.save(share);
    this.logger.log(
      `Contract ${params.contractId} shared with ${params.sharedWithEmail} by user ${params.sharedBy}`,
    );
    return saved;
  }

  async getSharesByContract(contractId: string): Promise<ContractShare[]> {
    return this.shareRepository.find({
      where: { contract_id: contractId, is_active: true },
      relations: ['sharer'],
      order: { created_at: 'DESC' },
    });
  }

  async getContractByShareToken(
    token: string,
  ): Promise<{ share: ContractShare; contract: Contract }> {
    const share = await this.shareRepository.findOne({
      where: { token, is_active: true },
    });

    if (!share) {
      throw new NotFoundException('Share link not found or has been revoked');
    }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      throw new BadRequestException('This share link has expired');
    }

    const contract = await this.contractRepository.findOne({
      where: { id: share.contract_id },
      relations: [
        'project',
        'contract_clauses',
        'contract_clauses.clause',
        'risk_analyses',
      ],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Update accessed_at
    await this.shareRepository.update(share.id, { accessed_at: new Date() });

    return { share, contract };
  }

  async revokeShare(shareId: string, userId: string): Promise<void> {
    const share = await this.shareRepository.findOne({
      where: { id: shareId, shared_by: userId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    await this.shareRepository.update(share.id, { is_active: false });
    this.logger.log(`Share ${shareId} revoked by user ${userId}`);
  }
}
