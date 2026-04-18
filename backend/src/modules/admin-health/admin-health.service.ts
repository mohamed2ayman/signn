import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { DataSource } from 'typeorm';
import { Queue } from 'bull';
import Redis from 'ioredis';
import axios from 'axios';

type ServiceStatus = 'up' | 'down' | 'skipped';

export interface ServiceHealth {
  status: ServiceStatus;
  responseTime?: number;
}

export interface QueueHealth {
  status: ServiceStatus;
  waiting: number;
  active: number;
  failed: number;
}

export interface SystemHealthResponse {
  overall: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  timestamp: string;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    emailQueue: QueueHealth;
    aiQueue: QueueHealth;
    aiBackend: ServiceHealth;
    s3: { status: ServiceStatus };
  };
}

@Injectable()
export class AdminHealthService {
  private readonly logger = new Logger(AdminHealthService.name);
  private readonly aiBackendUrl: string;
  private readonly redis: Redis;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectQueue('email-queue')
    private readonly emailQueue: Queue,

    @InjectQueue('obligation-reminders')
    private readonly obligationQueue: Queue,

    private readonly configService: ConfigService,
  ) {
    this.aiBackendUrl = this.configService.get<string>(
      'AI_BACKEND_URL',
      'http://ai-backend:8000',
    );

    const redisUrl = this.configService.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      lazyConnect: true,
    });
  }

  async getHealth(): Promise<SystemHealthResponse> {
    const [postgres, redis, emailQueue, aiQueue, aiBackend, s3] =
      await Promise.all([
        this.checkPostgres(),
        this.checkRedis(),
        this.checkQueue(this.emailQueue),
        this.checkQueue(this.obligationQueue),
        this.checkAiBackend(),
        this.checkS3(),
      ]);

    const criticalDown =
      postgres.status === 'down' || redis.status === 'down';
    const nonCriticalDown = [
      aiBackend.status,
      emailQueue.status,
      aiQueue.status,
    ].some((s) => s === 'down');

    const overall: SystemHealthResponse['overall'] = criticalDown
      ? 'DOWN'
      : nonCriticalDown
        ? 'DEGRADED'
        : 'HEALTHY';

    return {
      overall,
      timestamp: new Date().toISOString(),
      services: {
        postgres,
        redis,
        emailQueue,
        aiQueue,
        aiBackend,
        s3,
      },
    };
  }

  // ─── Individual checks ──────────────────────────────────────────────────────

  private async checkPostgres(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up', responseTime: Date.now() - start };
    } catch (err) {
      this.logger.warn(`PostgreSQL health check failed: ${(err as Error).message}`);
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      // Connect lazily — no-op if already connected
      if (this.redis.status === 'wait' || this.redis.status === 'close' || this.redis.status === 'end') {
        await this.redis.connect();
      }
      await this.redis.ping();
      return { status: 'up', responseTime: Date.now() - start };
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return { status: 'down' };
    }
  }

  private async checkQueue(queue: Queue): Promise<QueueHealth> {
    try {
      const [waiting, active, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getFailedCount(),
      ]);
      return { status: 'up', waiting, active, failed };
    } catch (err) {
      this.logger.warn(
        `Queue "${queue.name}" health check failed: ${(err as Error).message}`,
      );
      return { status: 'down', waiting: 0, active: 0, failed: 0 };
    }
  }

  private async checkAiBackend(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      await axios.get(`${this.aiBackendUrl}/health`, { timeout: 3000 });
      return { status: 'up', responseTime: Date.now() - start };
    } catch (err) {
      this.logger.warn(`AI backend health check failed: ${(err as Error).message}`);
      return { status: 'down' };
    }
  }

  private async checkS3(): Promise<{ status: ServiceStatus }> {
    const bucket = this.configService.get<string>('AWS_S3_BUCKET', '');
    if (!bucket) {
      // S3 not configured — skip gracefully
      return { status: 'skipped' };
    }

    try {
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
          secretAccessKey: this.configService.get<string>(
            'AWS_SECRET_ACCESS_KEY',
            '',
          ),
        },
      });
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }
}
