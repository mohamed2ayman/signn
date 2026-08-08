import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KnowledgeAsset,
  AssetReviewStatus,
  OperationsSettings,
} from '../../database/entities';
import {
  BatchReviewAction,
  BatchReviewDto,
  QueueQueryDto,
} from './dto';
import { StorageService } from '../storage/storage.service';

const AI_SOURCES = ['AI_EXTRACTED', 'AI_DRAFTED'];

const DEFAULT_THRESHOLD = 90;
const DEFAULT_AI_ACCURACY = 94.2;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class OperationsReviewService {
  /** The singleton `operations_settings` row id — mirrors SecurityPolicyService. */
  private static readonly SETTINGS_SINGLETON_ID = 'global';

  private readonly logger = new Logger(OperationsReviewService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly assetRepo: Repository<KnowledgeAsset>,
    @InjectRepository(OperationsSettings)
    private readonly settingsRepo: Repository<OperationsSettings>,
    private readonly storage: StorageService,
  ) {}

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    pendingCount: number;
    approvedToday: number;
    rejectedToday: number;
    aiAccuracyRate: number;
    totalReviewedAllTime: number;
  }> {
    const today = startOfToday();

    const [
      pendingCount,
      approvedToday,
      rejectedToday,
      totalApproved,
      totalRejected,
    ] = await Promise.all([
      this.assetRepo.count({
        where: { review_status: AssetReviewStatus.PENDING_REVIEW },
      }),
      this.assetRepo
        .createQueryBuilder('a')
        .where('a.review_status = :s', { s: AssetReviewStatus.APPROVED })
        .andWhere('a.updated_at >= :today', { today })
        .getCount(),
      this.assetRepo
        .createQueryBuilder('a')
        .where('a.review_status = :s', { s: AssetReviewStatus.REJECTED })
        .andWhere('a.updated_at >= :today', { today })
        .getCount(),
      this.assetRepo.count({
        where: { review_status: AssetReviewStatus.APPROVED },
      }),
      this.assetRepo.count({
        where: { review_status: AssetReviewStatus.REJECTED },
      }),
    ]);

    // ── AI accuracy: manually APPROVED AI-detected assets / total reviewed
    //    AI-detected assets (APPROVED + REJECTED with AI source)
    const aiReviewedQb = this.assetRepo
      .createQueryBuilder('a')
      .where('a.source IN (:...sources)', { sources: AI_SOURCES })
      .andWhere('a.review_status IN (:...statuses)', {
        statuses: [AssetReviewStatus.APPROVED, AssetReviewStatus.REJECTED],
      });

    const totalAiReviewed = await aiReviewedQb.getCount();

    let aiAccuracyRate = DEFAULT_AI_ACCURACY;
    if (totalAiReviewed > 0) {
      const aiApproved = await this.assetRepo
        .createQueryBuilder('a')
        .where('a.source IN (:...sources)', { sources: AI_SOURCES })
        .andWhere('a.review_status = :s', {
          s: AssetReviewStatus.APPROVED,
        })
        .getCount();
      aiAccuracyRate = +((aiApproved / totalAiReviewed) * 100).toFixed(1);
    }

    return {
      pendingCount,
      approvedToday,
      rejectedToday,
      aiAccuracyRate,
      totalReviewedAllTime: totalApproved + totalRejected,
    };
  }

  // ─── Queue ────────────────────────────────────────────────────────────────

  async getQueue(query: QueueQueryDto) {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.assetRepo
      .createQueryBuilder('a')
      .where('a.review_status = :s', {
        s: AssetReviewStatus.PENDING_REVIEW,
      });

    if (query.minConfidence !== undefined) {
      qb.andWhere('a.confidence_score >= :min', { min: query.minConfidence });
    }
    if (query.maxConfidence !== undefined) {
      qb.andWhere('a.confidence_score <= :max', { max: query.maxConfidence });
    }
    if (query.category) {
      qb.andWhere('a.asset_type = :cat', { cat: query.category });
    }

    qb.orderBy('a.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    // Runs only after JwtAuthGuard + RolesGuard(@Roles SYSTEM_ADMIN, OPERATIONS)
    // have authorized the caller, so the presigned URLs minted in toQueueItem
    // are only ever generated for an authorized reviewer (mint-after-auth).
    const data = await Promise.all(rows.map((a) => this.toQueueItem(a)));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private async toQueueItem(a: KnowledgeAsset) {
    const langs = a.detected_languages ?? null;
    const language = langs && langs.length > 0 ? langs[0] : 'English';

    // page_count is not tracked on the entity directly — attempt to read from
    // the `content` jsonb metadata if present, else return null.
    const pageCount =
      (a.content && typeof a.content === 'object' && 'page_count' in a.content
        ? Number((a.content as any).page_count)
        : null) || null;

    // DECIMAL columns come back from TypeORM as strings — coerce to number.
    const confidence =
      a.confidence_score === null || a.confidence_score === undefined
        ? null
        : Number(a.confidence_score);

    return {
      id: a.id,
      title: a.title,
      asset_type: a.asset_type,
      tags: a.tags ?? [],
      jurisdiction: a.jurisdiction ?? null,
      confidence_score: confidence,
      created_at: a.created_at,
      // Presign so the "Open file" link works on a private S3 bucket; the local
      // adapter returns the URL unchanged (local dev is unaffected). Default 1h
      // TTL — a reviewer opens the file during the active review session. Skip
      // the mint when there is no file.
      file_url: a.file_url
        ? await this.storage.getDownloadUrl(a.file_url)
        : null,
      embedding_status: a.embedding_status,
      ocr_status: a.ocr_status,
      detected_languages: langs,
      include_in_risk_analysis: a.include_in_risk_analysis,
      include_in_citations: a.include_in_citations,
      source: a.source ?? null,
      page_count: pageCount,
      language,
    };
  }

  // ─── Batch review ─────────────────────────────────────────────────────────

  async batchReview(
    dto: BatchReviewDto,
    reviewerId: string,
  ): Promise<{ processed: number; failed: number; errors?: string[] }> {
    const targetStatus =
      dto.action === BatchReviewAction.APPROVE
        ? AssetReviewStatus.APPROVED
        : AssetReviewStatus.REJECTED;

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of dto.assetIds) {
      try {
        const asset = await this.assetRepo.findOne({ where: { id } });
        if (!asset) {
          failed++;
          errors.push(`${id}: not found`);
          continue;
        }
        asset.review_status = targetStatus;
        asset.reviewed_by = reviewerId;
        asset.reviewed_at = new Date();
        await this.assetRepo.save(asset);
        processed++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${id}: ${msg}`);
        this.logger.warn(`Batch review failed for asset ${id}: ${msg}`);
      }
    }

    this.logger.log(
      `Batch review by ${reviewerId}: ${processed} processed, ${failed} failed`,
    );

    return {
      processed,
      failed,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  // ─── Confidence threshold (persisted to the operations_settings singleton) ─

  async getConfidenceThreshold(): Promise<{ threshold: number }> {
    try {
      const row = await this.settingsRepo.findOne({
        where: { id: OperationsReviewService.SETTINGS_SINGLETON_ID },
      });
      const threshold =
        row && typeof row.confidence_threshold === 'number'
          ? row.confidence_threshold
          : DEFAULT_THRESHOLD;
      return { threshold };
    } catch (error) {
      // A fresh/empty DB (missing seed row) or a transient read error must
      // never break the admin screen — fall back to the default, exactly as
      // the old file-based path did on any read failure.
      this.logger.warn(
        `[getConfidenceThreshold] Failed to read confidence threshold, using default ${DEFAULT_THRESHOLD}: ${(error as Error).message}`,
      );
      return { threshold: DEFAULT_THRESHOLD };
    }
  }

  async setConfidenceThreshold(
    threshold: number,
  ): Promise<{ threshold: number; updatedAt: string }> {
    if (threshold < 0 || threshold > 100 || Number.isNaN(threshold)) {
      throw new BadRequestException('threshold must be between 0 and 100');
    }

    try {
      // Upsert by primary key. The migration seeds the 'global' row, but save()
      // also creates it defensively if a fresh DB is missing the seed.
      await this.settingsRepo.save({
        id: OperationsReviewService.SETTINGS_SINGLETON_ID,
        confidence_threshold: threshold,
      });
      const row = await this.settingsRepo.findOne({
        where: { id: OperationsReviewService.SETTINGS_SINGLETON_ID },
      });
      return {
        threshold,
        updatedAt: (row?.updated_at ?? new Date()).toISOString(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to persist confidence threshold: ${msg}`);
      throw new BadRequestException(
        'Could not persist confidence threshold: ' + msg,
      );
    }
  }

  // ─── Helper (unused publicly, preserved for future expansion) ────────────

  async findAssetById(id: string): Promise<KnowledgeAsset> {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Knowledge asset not found');
    return asset;
  }
}
