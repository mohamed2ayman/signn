import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { DocumentProcessingService } from './document-processing.service';
import { UploadDocumentDto } from './dto';
import { ClauseReviewStatus } from '../../database/entities';

@Controller('contracts/:contractId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentProcessingController {
  constructor(
    private readonly documentProcessingService: DocumentProcessingService,
  ) {}

  // ─── Document Upload & Processing ─────────────────────────

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.documentProcessingService.uploadAndProcess(
      contractId,
      file as any,
      user.id,
      orgId,
      {
        document_label: dto.document_label,
        document_priority: dto.document_priority,
      },
    );
  }

  @Get('documents')
  async getDocuments(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.documentProcessingService.getDocuments(contractId);
  }

  @Get('documents/:docId/status')
  async getDocumentStatus(
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    // Poll and advance pipeline, then return status
    return this.documentProcessingService.pollAndAdvance(docId);
  }

  @Post('documents/:docId/reprocess')
  async reprocessDocument(
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentProcessingService.reprocess(docId);
  }

  @Put('documents/:docId/extracted-text')
  async updateExtractedText(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() body: { text: string },
    @OrganizationId() orgId: string,
  ) {
    return this.documentProcessingService.updateExtractedText(docId, orgId, body.text);
  }

  // ─── Clause Review ────────────────────────────────────────

  @Get('review/clauses')
  async getClausesForReview(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.documentProcessingService.getClausesForReview(contractId);
  }

  @Put('review/clauses/:clauseId')
  async updateClauseReview(
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @Body()
    body: {
      review_status: ClauseReviewStatus;
      title?: string;
      content?: string;
      clause_type?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.documentProcessingService.updateClauseReview(
      clauseId,
      body,
      user.id,
    );
  }

  @Post('review/clauses/bulk-approve')
  async bulkApproveReview(
    @Body() body: { clause_ids: string[] },
    @CurrentUser() user: any,
  ) {
    await this.documentProcessingService.bulkApproveReview(
      body.clause_ids,
      user.id,
    );
    return { message: 'Clauses approved successfully' };
  }

  @Post('review/finalize')
  async finalizeReview(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @OrganizationId() orgId: string,
  ) {
    return this.documentProcessingService.finalizeReview(contractId, orgId);
  }
}
