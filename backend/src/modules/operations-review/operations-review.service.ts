import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  KnowledgeAsset,
  AssetReviewStatus,
} from '../../database/entities';
import {
  BatchReviewAction,
  BatchReviewDto,
  QueueQueryDto,
} from './dto';

const AI_SOURCES = ['AI_EXTRACTED', 'AI_DRAFTED'];

const CONFIG_PATH = path.resolve(
  __dirname,
  '../../config/operations-config.json',
);

const DEFAULT_THRESHOLD = 90;
const DEFAULT_AI_ACCURACY = 94.2;

interface OperationsConfig {
  confidence_threshold: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class OperationsReviewService {
  private readonly logger = new Logger(OperationsReviewService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly assetRepo: Repository<KnowledgeAsset>,
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

    const data = rows.map((a) => this.toQueueItem(a));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private toQueueItem(a: KnowledgeAsset) {
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
      file_url: a.file_url ?? null,
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

  // ─── Confidence threshold (persisted to JSON file) ───────────────────────

  async getConfidenceThreshold(): Promise<{ threshold: number }> {
    try {
      const raw = await fs.readFile(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OperationsConfig>;
      const threshold =
        typeof parsed.confidence_threshold === 'number'
          ? parsed.confidence_threshold
          : DEFAULT_THRESHOLD;
      return { threshold };
    } catch {
      return { threshold: DEFAULT_THRESHOLD };
    }
  }

  async setConfidenceThreshold(
    threshold: number,
  ): Promise<{ threshold: number; updatedAt: string }> {
    if (threshold < 0 || threshold > 100 || Number.isNaN(threshold)) {
      throw new BadRequestException('threshold must be between 0 and 100');
    }

    const payload: OperationsConfig = { confidence_threshold: threshold };
    const dir = path.dirname(CONFIG_PATH);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to persist operations-config.json: ${msg}`);
      throw new BadRequestException(
        'Could not persist confidence threshold: ' + msg,
      );
    }

    return { threshold, updatedAt: new Date().toISOString() };
  }

  // ─── Helper (unused publicly, preserved for future expansion) ────────────

  async findAssetById(id: string): Promise<KnowledgeAsset> {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Knowledge asset not found');
    return asset;
  }
}
