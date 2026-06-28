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
import { ContractsService } from '../contracts/contracts.service';
import { ApplyProposedVersionDto } from '../contracts/dto/apply-proposed-version.dto';
import { UploadDocumentDto } from './dto';
import { ClauseIdsDto } from './dto/clause-ids.dto';
import { ClauseReviewStatus } from '../../database/entities';
import {
  validateFileType,
  ALLOWED_CONTRACT_MIMES,
  ALLOWED_CONTRACT_EXTENSIONS,
} from '../../common/utils/file-validation';

@Controller('contracts/:contractId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentProcessingController {
  constructor(
    private readonly documentProcessingService: DocumentProcessingService,
    // Guest version review (2a) — applyProposedVersion lives on ContractsService
    // (it owns createVersionSnapshot + the contract_clauses / contract_versions
    // repos). ContractsModule exports it; this module already imports it.
    private readonly contractsService: ContractsService,
  ) {}

  // ─── Document Upload & Processing ─────────────────────────

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadDocument(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    validateFileType(file, ALLOWED_CONTRACT_MIMES, ALLOWED_CONTRACT_EXTENSIONS, 'PDF/DOCX');
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
    @OrganizationId() orgId: string,
  ) {
    // Tenant-isolation Tier 2 — service walls the URL contractId
    // against the caller's org before any read.
    return this.documentProcessingService.getDocuments(contractId, orgId);
  }

  @Get('documents/:docId/status')
  async getDocumentStatus(
    @Param('docId', ParseUUIDPipe) docId: string,
    @OrganizationId() orgId: string,
  ) {
    // Tenant-isolation Tier 2 — CHILD-KEYED. The service walks
    // doc → contract → org via ContractAccessService.findInOrg.
    // Poll and advance pipeline, then return status.
    return this.documentProcessingService.pollAndAdvance(docId, orgId);
  }

  @Post('documents/:docId/reprocess')
  async reprocessDocument(
    @Param('docId', ParseUUIDPipe) docId: string,
    @OrganizationId() orgId: string,
  ) {
    // Tenant-isolation Tier 1 — orgId is now required so the service
    // can wall the doc's contract via ContractAccessService.findInOrg.
    return this.documentProcessingService.reprocess(docId, orgId);
  }

  @Get('documents/:docId/proposed-clauses')
  async getProposedClauses(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @OrganizationId() orgId: string,
  ) {
    // Host-v1 — the managing side reviews the PROPOSED clauses a bound guest
    // submitted via a new-version upload (Option C). Walled by findInOrg in the
    // service (cross-tenant probe → 404).
    return this.documentProcessingService.getProposedClauses(
      contractId,
      docId,
      orgId,
    );
  }

  @Get('documents/:docId/proposed-version/compare')
  async compareProposedVersion(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @OrganizationId() orgId: string,
  ) {
    // Host-v1 (2b) — diff a guest's proposed set against the current live
    // clauses. Org-scoped via findInOrg inside the service (cross-tenant → 404).
    // Returns the {summary, changes} shape the DiffViewer consumes.
    return this.contractsService.compareProposedVersion(contractId, docId, orgId);
  }

  @Post('documents/:docId/proposed-version/apply')
  async applyProposedVersion(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: ApplyProposedVersionDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    // Host-v1 (2a) — the managing side commits its per-clause decisions on a
    // guest-proposed version. Org-scoped via findInOrg inside the service
    // (cross-tenant probe → 404). Snapshot-before + parent-chain + atomic.
    return this.contractsService.applyProposedVersion(
      contractId,
      docId,
      dto,
      user.id,
      orgId,
    );
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
    @OrganizationId() orgId: string,
  ) {
    return this.documentProcessingService.getClausesForReview(contractId, orgId);
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
    @Body() body: ClauseIdsDto,
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
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    // Phase 7.18 — thread the acting user's id so the finalize_review
    // metering reserve can attribute the ledger actor_ref (NOT NULL UUID)
    // and run the engine's MANAGING JWT cross-check. account_type defaults
    // to MANAGING inside the service (this route is managing-only).
    return this.documentProcessingService.finalizeReview(contractId, orgId, {
      user_id: user.id,
    });
  }
}
