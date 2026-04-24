import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { OperationsReviewService } from './operations-review.service';
import {
  BatchReviewDto,
  ConfidenceThresholdDto,
  QueueQueryDto,
} from './dto';

@Controller('admin/operations-review')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationsReviewController {
  constructor(private readonly service: OperationsReviewService) {}

  /**
   * GET /admin/operations-review/stats
   * SYSTEM_ADMIN + OPERATIONS.
   */
  @Get('stats')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  getStats() {
    return this.service.getStats();
  }

  /**
   * GET /admin/operations-review/queue
   * Paginated list of KnowledgeAssets with review_status = PENDING_REVIEW.
   */
  @Get('queue')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  getQueue(@Query() query: QueueQueryDto) {
    return this.service.getQueue(query);
  }

  /**
   * POST /admin/operations-review/batch
   * Batch-approve or batch-reject a set of assets.
   */
  @Post('batch')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  batchReview(@Body() dto: BatchReviewDto, @CurrentUser() user: any) {
    return this.service.batchReview(dto, user.id);
  }

  /**
   * GET /admin/operations-review/confidence-threshold
   * Reads the single global threshold from the on-disk config.
   */
  @Get('confidence-threshold')
  @Roles(UserRole.SYSTEM_ADMIN)
  getThreshold() {
    return this.service.getConfidenceThreshold();
  }

  /**
   * PUT /admin/operations-review/confidence-threshold
   * Persists the threshold to operations-config.json.
   */
  @Put('confidence-threshold')
  @Roles(UserRole.SYSTEM_ADMIN)
  setThreshold(@Body() dto: ConfidenceThresholdDto) {
    return this.service.setConfidenceThreshold(dto.threshold);
  }
}
