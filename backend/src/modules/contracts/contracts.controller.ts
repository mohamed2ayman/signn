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
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole, PermissionLevel } from '../../database/entities';
import { ContractsService } from './contracts.service';
import {
  CreateContractDto,
  UpdateContractDto,
  AddClauseDto,
  UpdateClauseOrderDto,
  AddCommentDto,
  UpdateStatusDto,
} from './dto';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  // ─── Contract CRUD ─────────────────────────────────────────

  @Get()
  @RequirePermission(PermissionLevel.VIEWER)
  async findAll(
    @Query('project_id', ParseUUIDPipe) projectId: string,
    @Query('status') status?: string,
    @Query('contract_type') contractType?: string,
    @Query('search') search?: string,
  ) {
    return this.contractsService.findAll(projectId, {
      status,
      contract_type: contractType,
      search,
    });
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsService.findById(id);
  }

  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(
    @Body() dto: CreateContractDto,
    @CurrentUser() user: any,
  ) {
    return this.contractsService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermission(PermissionLevel.EDITOR)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contractsService.update(id, dto);
  }

  @Put(':id/status')
  @RequirePermission(PermissionLevel.APPROVER)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.contractsService.updateStatus(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission(PermissionLevel.EDITOR)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.contractsService.delete(id);
    return { message: 'Contract deleted successfully' };
  }

  // ─── Clause Management ─────────────────────────────────────

  @Get(':id/clauses')
  async getClauses(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsService.getContractClauses(id);
  }

  @Post(':id/clauses')
  @RequirePermission(PermissionLevel.EDITOR)
  async addClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddClauseDto,
  ) {
    return this.contractsService.addClause(id, dto);
  }

  @Put(':id/clauses/:clauseId')
  @RequirePermission(PermissionLevel.EDITOR)
  async updateContractClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @Body() dto: UpdateClauseOrderDto,
  ) {
    return this.contractsService.updateContractClause(id, clauseId, dto);
  }

  @Delete(':id/clauses/:clauseId')
  @RequirePermission(PermissionLevel.EDITOR)
  async removeClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
  ) {
    await this.contractsService.removeClause(id, clauseId);
    return { message: 'Clause removed from contract' };
  }

  @Put(':id/clauses/reorder')
  @RequirePermission(PermissionLevel.EDITOR)
  async reorderClauses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { clauses: { id: string; order_index: number }[] },
  ) {
    await this.contractsService.reorderClauses(id, body.clauses);
    return { message: 'Clauses reordered successfully' };
  }

  // ─── Version Management ────────────────────────────────────

  @Get(':id/versions')
  async getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsService.getVersions(id);
  }

  @Get(':id/versions/:versionId')
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.contractsService.getVersion(id, versionId);
  }

  @Post(':id/versions')
  @RequirePermission(PermissionLevel.EDITOR)
  async saveNewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { change_summary: string },
    @CurrentUser() user: any,
  ) {
    return this.contractsService.saveNewVersion(
      id,
      user.id,
      body.change_summary,
    );
  }

  // ─── Comments ──────────────────────────────────────────────

  @Get(':id/comments')
  async getComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('clause_id') clauseId?: string,
  ) {
    return this.contractsService.getComments(id, clauseId);
  }

  @Post(':id/comments')
  @RequirePermission(PermissionLevel.COMMENTER)
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: any,
  ) {
    return this.contractsService.addComment(id, dto, user.id);
  }

  @Put(':id/comments/:commentId/resolve')
  @RequirePermission(PermissionLevel.EDITOR)
  async resolveComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.contractsService.resolveComment(id, commentId);
  }

  // ─── Contractor Responses ──────────────────────────────────

  @Get(':id/responses')
  async getContractorResponses(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsService.getContractorResponses(id);
  }
}
