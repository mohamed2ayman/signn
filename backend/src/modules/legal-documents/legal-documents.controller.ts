import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { LegalDocumentsService } from './legal-documents.service';
import { CreateLegalDocumentDto } from './dto';
import { ListLegalDocumentsDto } from './dto';

/**
 * Admin-only controller for the legal corpus.
 *
 * All endpoints require SYSTEM_ADMIN — legal document ingestion is an
 * operations task, not a per-org user action.
 *
 * File upload limit: 50 MB (Phase 3.4 rule — every FileInterceptor must
 * have an explicit fileSize limit).
 */
@Controller('admin/legal-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class LegalDocumentsController {
  constructor(private readonly legalDocumentsService: LegalDocumentsService) {}

  /**
   * POST /admin/legal-documents
   *
   * Upload a PDF legal document and start the ingestion pipeline.
   * Returns the created document row immediately; ingestion runs async
   * (text extraction → chunking → embedding).
   *
   * The multipart body carries:
   *   - `file` (required) — the PDF
   *   - all fields from CreateLegalDocumentDto as form fields
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateLegalDocumentDto,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub;
    return this.legalDocumentsService.createWithUpload(dto, file, userId);
  }

  /**
   * GET /admin/legal-documents
   *
   * Paginated list. Supports optional filters: jurisdiction, status, search.
   */
  @Get()
  findAll(@Query() dto: ListLegalDocumentsDto) {
    return this.legalDocumentsService.findAll(dto);
  }

  /**
   * GET /admin/legal-documents/:id
   *
   * Single document with chunk count attached.
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.legalDocumentsService.findByIdWithChunkCount(id);
  }

  /**
   * DELETE /admin/legal-documents/:id
   *
   * Hard-deletes the document row.
   * Chunks are cascade-deleted by the FK. Storage file is removed
   * on a best-effort basis (StorageService.deleteFile).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.legalDocumentsService.remove(id);
  }
}
