import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { UserRole } from '../../database/entities';
import { KnowledgeAssetsService } from './knowledge-assets.service';
import {
  CreateKnowledgeAssetDto,
  UpdateKnowledgeAssetDto,
  ReviewAssetDto,
  CheckDuplicateDto,
} from './dto';

@Controller('knowledge-assets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KnowledgeAssetsController {
  constructor(
    private readonly knowledgeAssetsService: KnowledgeAssetsService,
  ) {}

  // ─── Named routes (must be declared BEFORE :id routes) ───────────────────

  @Get('pending-review')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async getPendingReview() {
    return this.knowledgeAssetsService.getPendingReviewAssets();
  }

  /**
   * POST /knowledge-assets/check-duplicate
   * Body: { hash: string }  — SHA-256 hex of the file buffer
   * Returns: { exists, assetId?, assetTitle? }
   */
  @Post('check-duplicate')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  async checkDuplicate(@Body() dto: CheckDuplicateDto) {
    return this.knowledgeAssetsService.checkDuplicateByHash(dto.hash);
  }

  // ─── Collection routes ────────────────────────────────────────────────────

  @Get()
  async findAll(
    @OrganizationId() orgId: string,
    @Query('asset_type') assetType?: string,
    @Query('review_status') reviewStatus?: string,
    @Query('embedding_status') embeddingStatus?: string,
    @Query('search') search?: string,
  ) {
    return this.knowledgeAssetsService.findAll(orgId, {
      asset_type: assetType,
      review_status: reviewStatus,
      embedding_status: embeddingStatus,
      search,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body() dto: CreateKnowledgeAssetDto,
    @UploadedFile() file: any,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.knowledgeAssetsService.create(dto, file || null, user.id, orgId);
  }

  // ─── Item routes (:id) ────────────────────────────────────────────────────

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.knowledgeAssetsService.findById(id, orgId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeAssetDto,
    @OrganizationId() orgId: string,
  ) {
    return this.knowledgeAssetsService.update(id, dto, orgId);
  }

  @Put(':id/review')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAssetDto,
    @CurrentUser() user: any,
  ) {
    return this.knowledgeAssetsService.review(id, dto, user.id);
  }

  /**
   * GET /knowledge-assets/:id/processing-status
   * Returns current OCR + embedding status for the asset.
   */
  @Get(':id/processing-status')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async getProcessingStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledgeAssetsService.getProcessingStatus(id);
  }

  /**
   * POST /knowledge-assets/:id/retry-ocr
   * Resets ocr_status + embedding_status to PENDING so the queue picks it up again.
   */
  @Post(':id/retry-ocr')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async retryOcr(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledgeAssetsService.retryOcr(id);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    await this.knowledgeAssetsService.delete(id, orgId);
    return { message: 'Knowledge asset deleted successfully' };
  }
}
