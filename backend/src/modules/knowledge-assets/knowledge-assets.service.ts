import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnsupportedMediaTypeException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { KnowledgeAsset, AssetReviewStatus } from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { CreateKnowledgeAssetDto, UpdateKnowledgeAssetDto, ReviewAssetDto } from './dto';

// ─── Format allowlist ─────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png']);

function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class KnowledgeAssetsService {
  private readonly logger = new Logger(KnowledgeAssetsService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly knowledgeAssetRepository: Repository<KnowledgeAsset>,
    private readonly storageService: StorageService,
  ) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  async findAll(
    orgId?: string,
    filters?: {
      asset_type?: string;
      review_status?: string;
      embedding_status?: string;
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

    if (filters?.embedding_status) {
      qb.andWhere('asset.embedding_status = :embeddingStatus', { embeddingStatus: filters.embedding_status });
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

  // ─── Duplicate detection ──────────────────────────────────────────────────

  async checkDuplicateByHash(hash: string): Promise<{
    exists: boolean;
    assetId?: string;
    assetTitle?: string;
  }> {
    const existing = await this.knowledgeAssetRepository.findOne({
      where: { file_hash: hash } as any,
      select: ['id', 'title'],
    });

    if (existing) {
      return { exists: true, assetId: existing.id, assetTitle: existing.title };
    }
    return { exists: false };
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(
    dto: CreateKnowledgeAssetDto,
    file: UploadedFile | null,
    userId: string,
    orgId?: string,
  ): Promise<KnowledgeAsset> {
    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let fileHash: string | null = null;

    if (file) {
      // ── Format validation ──────────────────────────────────────────────────
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new UnsupportedMediaTypeException(
          'Only PDF, DOCX, JPG, and PNG files are accepted.',
        );
      }

      // Check extension as a second guard (some clients lie about MIME type)
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new UnsupportedMediaTypeException(
          'Only PDF, DOCX, JPG, and PNG files are accepted.',
        );
      }

      // ── Duplicate detection ────────────────────────────────────────────────
      fileHash = computeSha256(file.buffer);
      const dup = await this.checkDuplicateByHash(fileHash);
      if (dup.exists) {
        throw new ConflictException(
          `A knowledge asset with this file already exists (ID: ${dup.assetId}).`,
        );
      }

      // ── Upload ────────────────────────────────────────────────────────────
      const result = await this.storageService.uploadFile(file, 'knowledge-assets');
      fileUrl = result.file_url;
      fileName = result.file_name;
    }

    const asset = this.knowledgeAssetRepository.create({
      ...dto,
      organization_id: orgId || null,
      file_url: fileUrl,
      file_name: fileName,
      file_hash: fileHash,
      created_by: userId,
      review_status: orgId
        ? AssetReviewStatus.PENDING_REVIEW
        : AssetReviewStatus.AUTO_APPROVED,
      ocr_status: file ? 'PENDING' : 'SKIPPED',
      embedding_status: 'PENDING',
      detected_languages: null,
    } as any);

    const saved: KnowledgeAsset = await this.knowledgeAssetRepository.save(asset as any) as any;

    this.logger.log(`Knowledge asset created: ${saved.id} by user ${userId}`);

    return saved;
  }

  // ─── Processing status ────────────────────────────────────────────────────

  async getProcessingStatus(id: string): Promise<{
    ocrStatus: string;
    embeddingStatus: string;
    detectedLanguages: string[] | null;
    processingProgress: number;
    errorMessage?: string;
  }> {
    const asset = await this.knowledgeAssetRepository.findOne({
      where: { id },
      select: ['id', 'ocr_status', 'embedding_status', 'detected_languages'] as any,
    });

    if (!asset) {
      throw new NotFoundException('Knowledge asset not found');
    }

    // Compute a rough progress percentage from status pairs
    const ocrWeight = 40;
    const embWeight = 60;

    const ocrProgress = this.statusToProgress(asset.ocr_status, ocrWeight);
    const embProgress = this.statusToProgress(asset.embedding_status, embWeight);
    const total = ocrProgress + embProgress;

    return {
      ocrStatus: asset.ocr_status,
      embeddingStatus: asset.embedding_status,
      detectedLanguages: (asset as any).detected_languages ?? null,
      processingProgress: Math.min(100, total),
    };
  }

  private statusToProgress(status: string, weight: number): number {
    switch (status) {
      case 'SKIPPED':
      case 'INDEXED':
      case 'COMPLETED':
        return weight;
      case 'PROCESSING':
        return Math.round(weight * 0.5);
      case 'FAILED':
        return 0;
      default: // PENDING
        return 0;
    }
  }

  // ─── Retry OCR ────────────────────────────────────────────────────────────

  async retryOcr(id: string): Promise<{ message: string }> {
    const asset = await this.knowledgeAssetRepository.findOne({ where: { id } });

    if (!asset) {
      throw new NotFoundException('Knowledge asset not found');
    }

    if (!asset.file_url) {
      throw new BadRequestException('This asset has no file to re-process.');
    }

    await this.knowledgeAssetRepository.update(id, {
      ocr_status: 'PENDING',
      embedding_status: 'PENDING',
    } as any);

    this.logger.log(`OCR retry queued for asset ${id}`);

    return { message: 'OCR and embedding re-queued successfully.' };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

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

  // ─── Review ───────────────────────────────────────────────────────────────

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

  // ─── Delete ───────────────────────────────────────────────────────────────

  async delete(id: string, orgId?: string): Promise<void> {
    const asset = await this.findById(id, orgId);

    if (asset.file_url) {
      await this.storageService.deleteFile(asset.file_url);
    }

    await this.knowledgeAssetRepository.remove(asset);
  }

  // ─── Pending review ───────────────────────────────────────────────────────

  async getPendingReviewAssets(): Promise<KnowledgeAsset[]> {
    return this.knowledgeAssetRepository.find({
      where: { review_status: AssetReviewStatus.PENDING_REVIEW },
      relations: ['creator', 'organization'],
      order: { created_at: 'ASC' },
    });
  }

  // ─── Embedding status update (called by AI queue consumer) ───────────────

  async updateEmbeddingStatus(
    id: string,
    status: string,
  ): Promise<void> {
    await this.knowledgeAssetRepository.update(id, {
      embedding_status: status,
    });
  }
}
