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
} from './dto';

@Controller('knowledge-assets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KnowledgeAssetsController {
  constructor(
    private readonly knowledgeAssetsService: KnowledgeAssetsService,
  ) {}

  @Get()
  async findAll(
    @OrganizationId() orgId: string,
    @Query('asset_type') assetType?: string,
    @Query('review_status') reviewStatus?: string,
    @Query('search') search?: string,
  ) {
    return this.knowledgeAssetsService.findAll(orgId, {
      asset_type: assetType,
      review_status: reviewStatus,
      search,
    });
  }

  @Get('pending-review')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async getPendingReview() {
    return this.knowledgeAssetsService.getPendingReviewAssets();
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.knowledgeAssetsService.findById(id, orgId);
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

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    await this.knowledgeAssetsService.delete(id, orgId);
    return { message: 'Knowledge asset deleted successfully' };
  }
}
