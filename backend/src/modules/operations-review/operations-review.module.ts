import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeAsset } from '../../database/entities';
import { OperationsReviewController } from './operations-review.controller';
import { OperationsReviewService } from './operations-review.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeAsset])],
  controllers: [OperationsReviewController],
  providers: [OperationsReviewService],
})
export class OperationsReviewModule {}
