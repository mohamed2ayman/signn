import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeAsset } from '../../database/entities';
import { KnowledgeAssetsController } from './knowledge-assets.controller';
import { KnowledgeAssetsService } from './knowledge-assets.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeAsset]),
    StorageModule,
  ],
  controllers: [KnowledgeAssetsController],
  providers: [KnowledgeAssetsService],
  exports: [KnowledgeAssetsService],
})
export class KnowledgeAssetsModule {}
