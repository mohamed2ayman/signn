import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import * as path from 'path';
import { StorageService } from './storage.service';
import {
  STORAGE_ADAPTER,
} from './interfaces/storage-adapter.interface';
import { LocalStorageAdapter } from './adapters/local-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('STORAGE_DRIVER', 'local');
        const uploadDir = config.get<string>(
          'UPLOAD_DIR',
          path.join(process.cwd(), 'uploads'),
        );
        const baseUrl = config.get<string>('BASE_URL', 'http://localhost:3000');

        if (driver === 's3') {
          const region = config.get<string>('AWS_REGION', 'us-east-1');
          const bucket = config.get<string>('AWS_S3_BUCKET', '');
          if (!bucket) {
            throw new Error('AWS_S3_BUCKET is required when STORAGE_DRIVER=s3');
          }
          const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID', '');
          const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY', '');

          const s3 = new S3Client({
            region,
            ...(accessKeyId && secretAccessKey
              ? { credentials: { accessKeyId, secretAccessKey } }
              : {}), // on ECS, fall back to the instance role / IRSA — no explicit credentials needed
          });

          return new S3StorageAdapter(s3, bucket, region);
        }

        // Default: local filesystem
        return new LocalStorageAdapter(uploadDir, baseUrl);
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
