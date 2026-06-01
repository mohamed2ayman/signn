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
  UploadedFiles,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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
  BulkCreateKnowledgeAssetDto,
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

  /**
   * POST /knowledge-assets/bulk
   * Accepts up to 20 files (PDF + DOCX only, 20 MB each) with shared metadata.
   * Partial-success model — duplicates and failures are reported per-file
   * without aborting the entire batch.
   * Returns: { created, duplicates, failed }
   */
  @Post('bulk')
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  @HttpCode(HttpStatus.OK)
  async bulkCreate(
    @Body() dto: BulkCreateKnowledgeAssetDto,
    @UploadedFiles() files: any[],
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.knowledgeAssetsService.bulkCreate(
      dto,
      files || [],
      user.id,
      orgId,
    );
  }

  // ─── Collection routes ────────────────────────────────────────────────────

  @Get()
  async findAll(
    @OrganizationId() orgId: string,
    @Query('asset_type') assetType?: string,
    @Query('review_status') reviewStatus?: string,
    @Query('embedding_status') embeddingStatus?: string,
    @Query('search') search?: string,
    /** Exact jurisdiction filter, e.g. ?jurisdiction=EG */
    @Query('jurisdiction') jurisdiction?: string,
    /**
     * Comma-separated tag filter, e.g. ?tags=type:PLAYBOOK,standard:FIDIC_RED_BOOK_2017
     * The service requires the asset to contain ALL supplied tags.
     */
    @Query('tags') tagsParam?: string,
    /**
     * Phase 7.24e — optional project scope.
     * When supplied, assets scoped to this project are included alongside
     * platform + org-wide assets.
     */
    @Query('project_id') projectId?: string,
  ) {
    const tags = tagsParam
      ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    return this.knowledgeAssetsService.findAll(orgId, {
      asset_type: assetType,
      review_status: reviewStatus,
      embedding_status: embeddingStatus,
      search,
      jurisdiction,
      tags,
      project_id: projectId,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
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
    @CurrentUser() user: any,
  ) {
    return this.knowledgeAssetsService.update(id, dto, orgId, user?.id);
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
   * GET /knowledge-assets/:id/versions
   * Returns the version list for an asset — version_number, changed_by,
   * changer_name, change_summary, created_at.  Newest-first.
   */
  @Get(':id/versions')
  async getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledgeAssetsService.getVersions(id);
  }

  /**
   * GET /knowledge-assets/:id/versions/:versionNumber
   * Returns the full snapshot for a specific version.
   */
  @Get(':id/versions/:versionNumber')
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.knowledgeAssetsService.getVersion(id, parseInt(versionNumber, 10));
  }

  /**
   * GET /knowledge-assets/:id/usages
   * Returns all "Used In" backlink rows for the asset, most recent first.
   * Response: Array<{ context_type, context_id, used_at }>
   */
  @Get(':id/usages')
  async getUsages(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledgeAssetsService.getUsages(id);
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
