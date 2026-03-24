import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeAsset, AssetReviewStatus } from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { CreateKnowledgeAssetDto, UpdateKnowledgeAssetDto, ReviewAssetDto } from './dto';

@Injectable()
export class KnowledgeAssetsService {
  private readonly logger = new Logger(KnowledgeAssetsService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly knowledgeAssetRepository: Repository<KnowledgeAsset>,
    private readonly storageService: StorageService,
  ) {}

  async findAll(
    orgId?: string,
    filters?: {
      asset_type?: string;
      review_status?: string;
      search?: string;
    },
  ): Promise<KnowledgeAsset[]> {
    const qb = this.knowledgeAssetRepository
      .createQueryBuilder('asset')
      .leftJoinAndSelect('asset.creator', 'creator')
      .leftJoinAndSelect('asset.reviewer', 'reviewer');

    if (orgId) {
      qb.where('(asset.organization_id = :orgId OR asset.organization_id IS NULL)', { orgId });
    }

    if (filters?.asset_type) {
      qb.andWhere('asset.asset_type = :assetType', { assetType: filters.asset_type });
    }

    if (filters?.review_status) {
      qb.andWhere('asset.review_status = :reviewStatus', { reviewStatus: filters.review_status });
    }

    if (filters?.search) {
      qb.andWhere(
        '(asset.title ILIKE :search OR asset.description ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('asset.created_at', 'DESC');

    return qb.getMany();
  }

  async findById(id: string, orgId?: string): Promise<KnowledgeAsset> {
    const qb = this.knowledgeAssetRepository
      .createQueryBuilder('asset')
      .leftJoinAndSelect('asset.creator', 'creator')
      .leftJoinAndSelect('asset.reviewer', 'reviewer')
      .leftJoinAndSelect('asset.organization', 'organization')
      .where('asset.id = :id', { id });

    if (orgId) {
      qb.andWhere('(asset.organization_id = :orgId OR asset.organization_id IS NULL)', { orgId });
    }

    const asset = await qb.getOne();

    if (!asset) {
      throw new NotFoundException('Knowledge asset not found');
    }

    return asset;
  }

  async create(
    dto: CreateKnowledgeAssetDto,
    file: UploadedFile | null,
    userId: string,
    orgId?: string,
  ): Promise<KnowledgeAsset> {
    let fileUrl: string | null = null;
    let fileName: string | null = null;

    if (file) {
      const result = await this.storageService.uploadFile(file, 'knowledge-assets');
      fileUrl = result.file_url;
      fileName = result.file_name;
    }

    const asset = this.knowledgeAssetRepository.create({
      ...dto,
      organization_id: orgId || null,
      file_url: fileUrl,
      file_name: fileName,
      created_by: userId,
      review_status: orgId
        ? AssetReviewStatus.PENDING_REVIEW
        : AssetReviewStatus.AUTO_APPROVED,
      embedding_status: 'PENDING',
    } as any);

    const saved: KnowledgeAsset = await this.knowledgeAssetRepository.save(asset as any) as any;

    this.logger.log(`Knowledge asset created: ${saved.id} by user ${userId}`);

    return saved;
  }

  async update(
    id: string,
    dto: UpdateKnowledgeAssetDto,
    orgId?: string,
  ): Promise<KnowledgeAsset> {
    const asset = await this.findById(id, orgId);

    if (dto.title !== undefined) asset.title = dto.title;
    if (dto.description !== undefined) asset.description = dto.description;
    if (dto.asset_type !== undefined) asset.asset_type = dto.asset_type;
    if (dto.jurisdiction !== undefined) asset.jurisdiction = dto.jurisdiction;
    if (dto.tags !== undefined) asset.tags = dto.tags;
    if (dto.include_in_risk_analysis !== undefined)
      asset.include_in_risk_analysis = dto.include_in_risk_analysis;
    if (dto.include_in_citations !== undefined)
      asset.include_in_citations = dto.include_in_citations;

    return this.knowledgeAssetRepository.save(asset);
  }

  async review(
    id: string,
    dto: ReviewAssetDto,
    reviewerId: string,
  ): Promise<KnowledgeAsset> {
    const asset = await this.knowledgeAssetRepository.findOne({
      where: { id },
    });

    if (!asset) {
      throw new NotFoundException('Knowledge asset not found');
    }

    asset.review_status = dto.review_status;
    asset.reviewed_by = reviewerId;
    asset.reviewed_at = new Date();

    return this.knowledgeAssetRepository.save(asset);
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const asset = await this.findById(id, orgId);

    if (asset.file_url) {
      await this.storageService.deleteFile(asset.file_url);
    }

    await this.knowledgeAssetRepository.remove(asset);
  }

  async getPendingReviewAssets(): Promise<KnowledgeAsset[]> {
    return this.knowledgeAssetRepository.find({
      where: { review_status: AssetReviewStatus.PENDING_REVIEW },
      relations: ['creator', 'organization'],
      order: { created_at: 'ASC' },
    });
  }

  async updateEmbeddingStatus(
    id: string,
    status: string,
  ): Promise<void> {
    await this.knowledgeAssetRepository.update(id, {
      embedding_status: status,
    });
  }
}
