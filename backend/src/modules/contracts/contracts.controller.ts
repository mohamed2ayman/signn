import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { UserRole, PermissionLevel } from '../../database/entities';
import { ContractsService } from './contracts.service';
import { ContractAccessService } from './services/contract-access.service';
import { ContractPinningService } from './services/contract-pinning.service';
import {
  CreateContractDto,
  UpdateContractDto,
  AddClauseDto,
  UpdateClauseOrderDto,
  AddCommentDto,
  UpdateStatusDto,
  RequestApprovalDto,
  ReviewApprovalDto,
} from './dto';
import { ReorderClausesDto } from './dto/reorder-clauses.dto';
import { UpdatePartiesDto } from './dto/update-parties.dto';
import { UpdateChangeSummaryDto } from './dto/update-change-summary.dto';
import { UpdateCommentContentDto } from './dto/update-comment-content.dto';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly contractAccess: ContractAccessService,
    private readonly contractPinning: ContractPinningService,
  ) {}

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
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    // Phase 7.18 bucket 1a — route through the shared authority so that
    // guest callers are evaluated against the guest_contract_access table
    // instead of the managing-user org-scope. Managing callers still get
    // PR #42's tenancy behaviour byte-for-byte (same query, same 404
    // semantics).
    return this.contractAccess.findAccessibleContract(id, {
      id: user.id,
      organization_id: user.organization_id ?? null,
      role: user.role,
      account_type: user.account_type,
    });
  }

  @Post()
  @RequirePermission(PermissionLevel.EDITOR)
  async create(
    @Body() dto: CreateContractDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.create(dto, user.id, orgId);
  }

  @Put(':id')
  @RequirePermission(PermissionLevel.EDITOR)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.update(id, dto, orgId);
  }

  @Put(':id/status')
  @RequirePermission(PermissionLevel.APPROVER)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.updateStatus(id, dto, user.id, orgId);
  }

  /**
   * Signed-state pinning (Slice 1) — manual "Mark as signed" door for
   * wet-signed-on-paper contracts (no DocuSign envelope). Funnels through
   * the SAME shared pin operation as the DocuSign completed webhook.
   * APPROVER permission, mirroring updateStatus. Idempotent: marking an
   * already-executed contract is a no-op returning the existing pin.
   */
  @Post(':id/mark-signed')
  @RequirePermission(PermissionLevel.APPROVER)
  async markSigned(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractPinning.markAsSigned(id, user.id, orgId);
  }

  /**
   * Signed-state pinning (Slice 2) — tamper-detection read path. Recomputes
   * the canonical hash from live content + the stored pin payload and
   * compares both to the pinned hash. Read-only; org-walled.
   */
  @Get(':id/verify-pin')
  @RequirePermission(PermissionLevel.VIEWER)
  async verifyPin(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractPinning.verifyContractPin(id, orgId);
  }

  @Delete(':id')
  @RequirePermission(PermissionLevel.EDITOR)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    await this.contractsService.delete(id, orgId);
    return { message: 'Contract deleted successfully' };
  }

  // ─── Party Names ────────────────────────────────────────────

  @Put(':id/parties')
  @RequirePermission(PermissionLevel.EDITOR)
  async updateParties(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePartiesDto,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.updateParties(id, body, orgId);
  }

  // ─── Clause Management ─────────────────────────────────────

  @Get(':id/clauses')
  async getClauses(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    // Tenant-isolation Tier 2 — service walls URL contractId.
    return this.contractsService.getContractClauses(id, orgId);
  }

  @Post(':id/clauses')
  @RequirePermission(PermissionLevel.EDITOR)
  async addClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddClauseDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.addClause(id, dto, orgId, user.id);
  }

  @Put(':id/clauses/:clauseId')
  @RequirePermission(PermissionLevel.EDITOR)
  async updateContractClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @Body() dto: UpdateClauseOrderDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    // Tenant-isolation Tier 1 — service now requires orgId for the
    // contract-access wall before mutating any contract_clause row.
    return this.contractsService.updateContractClause(id, clauseId, dto, user.id, orgId);
  }

  @Delete(':id/clauses/:clauseId')
  @RequirePermission(PermissionLevel.EDITOR)
  async removeClause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    await this.contractsService.removeClause(id, clauseId, user.id, orgId);
    return { message: 'Clause removed from contract' };
  }

  @Put(':id/clauses/reorder')
  @RequirePermission(PermissionLevel.EDITOR)
  async reorderClauses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderClausesDto,
    @OrganizationId() orgId: string,
  ) {
    await this.contractsService.reorderClauses(id, dto.clauses, orgId);
    return { message: 'Clauses reordered successfully' };
  }

  // ─── Version Management ────────────────────────────────────

  @Get(':id/versions')
  async getVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.getVersions(id, orgId);
  }

  @Get(':id/versions/milestones')
  async getMilestoneVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.getMilestoneVersions(id, orgId);
  }

  @Get(':id/versions/:versionA/compare/:versionB')
  async compareVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionA', ParseUUIDPipe) versionA: string,
    @Param('versionB', ParseUUIDPipe) versionB: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.compareVersions(id, versionA, versionB, orgId);
  }

  @Get(':id/versions/:versionId')
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.getVersion(id, versionId, orgId);
  }

  @Post(':id/versions')
  @RequirePermission(PermissionLevel.EDITOR)
  async saveNewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateChangeSummaryDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.saveNewVersion(
      id,
      user.id,
      body.change_summary,
      orgId,
    );
  }

  // ─── Comments ──────────────────────────────────────────────

  @Get(':id/comments')
  async getComments(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Query('clause_id') clauseId?: string,
  ) {
    return this.contractsService.getComments(id, orgId, clauseId);
  }

  @Post(':id/comments')
  @RequirePermission(PermissionLevel.COMMENTER)
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.addComment(id, dto, user.id, orgId);
  }

  @Put(':id/comments/:commentId/resolve')
  @RequirePermission(PermissionLevel.EDITOR)
  async resolveComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.resolveComment(id, commentId, orgId);
  }

  @Patch(':id/comments/:commentId')
  async updateComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: UpdateCommentContentDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.updateComment(id, commentId, user.id, body.content, orgId);
  }

  @Delete(':id/comments/:commentId')
  async deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    await this.contractsService.deleteComment(id, commentId, user.id, user.role, orgId);
    return { message: 'Comment deleted successfully' };
  }

  // ─── Contractor Responses ──────────────────────────────────

  @Get(':id/responses')
  async getContractorResponses(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.getContractorResponses(id, orgId);
  }

  // ─── Approval Workflow ─────────────────────────────────────

  /**
   * GET /contracts/:id/approvers
   * Returns all approver records with user details for a contract.
   */
  @Get(':id/approvers')
  async getApprovers(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.getApprovers(id, orgId);
  }

  /**
   * POST /contracts/:id/request-approval
   * Submits the contract for approval and assigns approvers.
   * Requires EDITOR permission (the creator/editor initiates).
   */
  @Post(':id/request-approval')
  @RequirePermission(PermissionLevel.EDITOR)
  async requestApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestApprovalDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.requestApproval(id, user.id, dto.approver_ids, orgId);
  }

  /**
   * POST /contracts/:id/review-approval
   * An assigned approver submits APPROVED or REJECTED with optional comment.
   * No special permission guard — service validates approver assignment.
   */
  @Post(':id/review-approval')
  async reviewApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewApprovalDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.contractsService.reviewApproval(id, user.id, dto.decision, orgId, dto.comment);
  }

  /**
   * GET /contracts/pending-approvals
   * Returns all contracts pending the current user's approval.
   */
  @Get('pending-approvals/mine')
  async getPendingApprovals(@CurrentUser() user: any) {
    return this.contractsService.getPendingApprovalsForUser(
      user.id,
      user.organization_id,
    );
  }
}
