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
import {
  KnowledgeAsset,
  KnowledgeAssetUsage,
  KnowledgeAssetVersion,
  AssetReviewStatus,
} from '../../database/entities';
import { StorageService, UploadedFile } from '../storage/storage.service';
import {
  CreateKnowledgeAssetDto,
  UpdateKnowledgeAssetDto,
  ReviewAssetDto,
  BulkCreateKnowledgeAssetDto,
} from './dto';
import { escapeLikeParam } from '../../common/utils/escape-like';

// ─── Format allowlist — single upload ────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png']);

// ─── Format allowlist — bulk upload (PDF + DOCX only) ────────────────────────
const BULK_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const BULK_ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx']);

function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class KnowledgeAssetsService {
  private readonly logger = new Logger(KnowledgeAssetsService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly knowledgeAssetRepository: Repository<KnowledgeAsset>,
    @InjectRepository(KnowledgeAssetUsage)
    private readonly usageRepository: Repository<KnowledgeAssetUsage>,
    @InjectRepository(KnowledgeAssetVersion)
    private readonly versionRepository: Repository<KnowledgeAssetVersion>,
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
      /** Exact-match filter on the jurisdiction column (e.g. 'EG', 'AE', 'UK') */
      jurisdiction?: string;
      /**
       * Tag containment filter — the asset's tags array must contain ALL of
       * the supplied tags.  Follows the @> pattern from
       * ComplianceKnowledgeService.queryByTags().
       */
      tags?: string[];
      /**
       * Phase 7.24e — optional project scope filter.
       * When supplied, project-scoped assets for this project are included
       * alongside platform + org-wide assets.
       * When omitted, only platform + org-wide assets are returned (backward compat).
       */
      project_id?: string;
    },
  ): Promise<KnowledgeAsset[]> {
    const qb = this.knowledgeAssetRepository
      .createQueryBuilder('asset')
      .leftJoinAndSelect('asset.creator', 'creator')
      .leftJoinAndSelect('asset.reviewer', 'reviewer')
      // Phase 7.24e — include project relation so frontend can show project name.
      .leftJoinAndSelect('asset.project', 'project');

    if (orgId) {
      if (filters?.project_id) {
        // Three-tier visibility: platform + org-wide + this project's assets.
        qb.where(
          '(asset.organization_id IS NULL AND asset.project_id IS NULL)' +
            ' OR (asset.organization_id = :orgId AND asset.project_id IS NULL)' +
            ' OR (asset.organization_id = :orgId AND asset.project_id = :projectId)',
          { orgId, projectId: filters.project_id },
        );
      } else {
        // Two-tier (backward compat): platform + org-wide only, no project assets.
        qb.where(
          '(asset.organization_id IS NULL AND asset.project_id IS NULL)' +
            ' OR (asset.organization_id = :orgId AND asset.project_id IS NULL)',
          { orgId },
        );
      }
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
        "(asset.title ILIKE :search OR asset.description ILIKE :search OR asset.content->>'summary' ILIKE :search)",
        { search: `%${escapeLikeParam(filters.search)}%` },
      );
    }

    if (filters?.jurisdiction) {
      qb.andWhere('asset.jurisdiction = :jurisdiction', {
        jurisdiction: filters.jurisdiction,
      });
    }

    if (filters?.tags && filters.tags.length > 0) {
      // @> checks that the asset's tags array contains ALL supplied tags.
      // JSON.stringify() produces the jsonb literal, e.g. '["type:PLAYBOOK"]'.
      qb.andWhere('asset.tags @> :tags::jsonb', {
        tags: JSON.stringify(filters.tags),
      });
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
    userId?: string,
    changeSummary?: string,
  ): Promise<KnowledgeAsset> {
    const asset = await this.findById(id, orgId);

    // ── Snapshot the current state BEFORE applying the patch (Phase 7.24d) ─
    // Mirror the pattern from ContractsService.createVersionSnapshot().
    // Wrapped in try/catch so a snapshot failure never blocks the update.
    try {
      await this.createAssetVersionSnapshot(asset, userId, changeSummary);
    } catch (err) {
      this.logger.warn(
        `Version snapshot failed for asset ${id}: ${(err as Error).message}`,
      );
    }

    if (dto.title !== undefined) asset.title = dto.title;
    if (dto.description !== undefined) asset.description = dto.description;
    if (dto.asset_type !== undefined) asset.asset_type = dto.asset_type;
    if (dto.jurisdiction !== undefined) asset.jurisdiction = dto.jurisdiction;
    if (dto.tags !== undefined) asset.tags = dto.tags;
    if (dto.include_in_risk_analysis !== undefined)
      asset.include_in_risk_analysis = dto.include_in_risk_analysis;
    if (dto.include_in_citations !== undefined)
      asset.include_in_citations = dto.include_in_citations;

    // Increment version counter on the live row.
    asset.version = (asset.version ?? 1) + 1;

    return this.knowledgeAssetRepository.save(asset);
  }

  /**
   * Captures an immutable snapshot of the asset's current state.
   * The snapshot is stored BEFORE the update is applied so every version
   * row represents the state that was in place at that version number.
   */
  private async createAssetVersionSnapshot(
    asset: KnowledgeAsset,
    userId?: string,
    changeSummary?: string,
  ): Promise<KnowledgeAssetVersion> {
    const snapshotData: Record<string, unknown> = {
      title: asset.title,
      description: asset.description,
      asset_type: asset.asset_type,
      jurisdiction: asset.jurisdiction,
      tags: asset.tags,
      content: asset.content,
      include_in_risk_analysis: asset.include_in_risk_analysis,
      include_in_citations: asset.include_in_citations,
      review_status: asset.review_status,
      ocr_status: asset.ocr_status,
      embedding_status: asset.embedding_status,
      file_name: asset.file_name,
      file_url: asset.file_url,
    };

    const row = this.versionRepository.create({
      asset_id: asset.id,
      version_number: asset.version ?? 1,
      snapshot_data: snapshotData,
      changed_by: userId ?? null,
      change_summary: changeSummary ?? null,
    });

    return this.versionRepository.save(row);
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

  // ─── Version history (Phase 7.24d) ───────────────────────────────────────

  /**
   * Returns the version list for an asset — version number, who changed it,
   * when, and optional change summary.  Ordered newest-first.
   */
  async getVersions(assetId: string): Promise<
    Array<{
      id: string;
      version_number: number;
      changed_by: string | null;
      changer_name: string | null;
      change_summary: string | null;
      created_at: Date;
    }>
  > {
    // Verify the asset exists first.
    const exists = await this.knowledgeAssetRepository.findOne({
      where: { id: assetId },
      select: ['id'] as any,
    });
    if (!exists) throw new NotFoundException('Knowledge asset not found');

    const rows = await this.versionRepository.find({
      where: { asset_id: assetId },
      relations: ['changer'],
      order: { version_number: 'DESC' },
    });

    return rows.map((r) => ({
      id: r.id,
      version_number: r.version_number,
      changed_by: r.changed_by,
      changer_name: r.changer
        ? `${(r.changer as any).first_name ?? ''} ${(r.changer as any).last_name ?? ''}`.trim() ||
          (r.changer as any).email
        : null,
      change_summary: r.change_summary,
      created_at: r.created_at,
    }));
  }

  /** Returns the full snapshot for a specific version. */
  async getVersion(
    assetId: string,
    versionNumber: number,
  ): Promise<KnowledgeAssetVersion> {
    // Verify asset exists.
    const exists = await this.knowledgeAssetRepository.findOne({
      where: { id: assetId },
      select: ['id'] as any,
    });
    if (!exists) throw new NotFoundException('Knowledge asset not found');

    const row = await this.versionRepository.findOne({
      where: { asset_id: assetId, version_number: versionNumber },
    });
    if (!row)
      throw new NotFoundException(
        `Version ${versionNumber} not found for this asset`,
      );

    return row;
  }

  // ─── Bulk create (Phase 7.24c) ───────────────────────────────────────────

  /**
   * Processes up to 20 files in a single request.
   * Partial-success model — one file failing does not block the others.
   * Duplicates (by SHA-256 hash) are collected and reported, not rejected.
   */
  async bulkCreate(
    dto: BulkCreateKnowledgeAssetDto,
    files: UploadedFile[],
    userId: string,
    orgId?: string,
  ): Promise<{
    created: Array<{ id: string; title: string; filename: string }>;
    duplicates: string[];
    failed: Array<{ filename: string; error: string }>;
  }> {
    const created: Array<{ id: string; title: string; filename: string }> = [];
    const duplicates: string[] = [];
    const failed: Array<{ filename: string; error: string }> = [];

    for (const file of files) {
      try {
        // ── Format validation (PDF + DOCX only) ─────────────────────────────
        if (!BULK_ALLOWED_MIME_TYPES.has(file.mimetype)) {
          failed.push({
            filename: file.originalname,
            error: 'Unsupported file type. Only PDF and DOCX are accepted for bulk import.',
          });
          continue;
        }
        const ext = file.originalname
          .toLowerCase()
          .slice(file.originalname.lastIndexOf('.'));
        if (!BULK_ALLOWED_EXTENSIONS.has(ext)) {
          failed.push({
            filename: file.originalname,
            error: 'Unsupported file extension. Only PDF and DOCX are accepted for bulk import.',
          });
          continue;
        }

        // ── Duplicate detection ──────────────────────────────────────────────
        const fileHash = computeSha256(file.buffer);
        const dup = await this.checkDuplicateByHash(fileHash);
        if (dup.exists) {
          duplicates.push(file.originalname);
          continue;
        }

        // ── Upload ───────────────────────────────────────────────────────────
        const result = await this.storageService.uploadFile(file, 'knowledge-assets');

        // ── Persist entity ───────────────────────────────────────────────────
        // Title is derived from the original filename (without extension).
        const titleFromFilename = file.originalname.replace(/\.[^/.]+$/, '');

        const asset = this.knowledgeAssetRepository.create({
          title: titleFromFilename,
          description: dto.description ?? null,
          asset_type: dto.asset_type,
          jurisdiction: dto.jurisdiction ?? null,
          tags: dto.tags ?? [],
          organization_id: orgId ?? null,
          // Phase 7.24e — project scope (optional; null = org-wide)
          project_id: dto.project_id ?? null,
          file_url: result.file_url,
          file_name: result.file_name,
          file_hash: fileHash,
          created_by: userId,
          review_status: orgId
            ? AssetReviewStatus.PENDING_REVIEW
            : AssetReviewStatus.AUTO_APPROVED,
          ocr_status: 'PENDING',
          embedding_status: 'PENDING',
          detected_languages: null,
        } as any);

        const saved = (await this.knowledgeAssetRepository.save(
          asset as any,
        )) as any;

        created.push({ id: saved.id, title: saved.title, filename: file.originalname });
        this.logger.log(
          `Bulk import: asset created ${saved.id} (${file.originalname}) by user ${userId}`,
        );
      } catch (err) {
        // lesson #31 — every catch must logger.error, never swallow silently
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `Bulk import: failed to import "${file.originalname}": ${message}`,
        );
        failed.push({ filename: file.originalname, error: message });
      }
    }

    return { created, duplicates, failed };
  }

  // ─── Used-In backlinks (Phase 7.24b) ─────────────────────────────────────

  /**
   * Returns all usage rows for a given asset, ordered by most recent first.
   * Used to power the "Used In" section on the KB detail view.
   */
  async getUsages(assetId: string): Promise<
    Array<{ context_type: string; context_id: string; used_at: Date }>
  > {
    // Verify the asset exists first (prevents info-leak on random UUIDs).
    const exists = await this.knowledgeAssetRepository.findOne({
      where: { id: assetId },
      select: ['id'] as any,
    });
    if (!exists) {
      throw new NotFoundException('Knowledge asset not found');
    }

    const rows = await this.usageRepository.find({
      where: { asset_id: assetId },
      order: { used_at: 'DESC' },
      select: ['context_type', 'context_id', 'used_at'] as any,
    });

    return rows.map((r) => ({
      context_type: r.context_type,
      context_id: r.context_id,
      used_at: r.used_at,
    }));
  }
}
