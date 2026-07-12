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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities';
import { RiskAnalysisService } from './risk-analysis.service';
import { RiskExplanationService } from './services/risk-explanation.service';
import { RiskOverrideService } from './services/risk-override.service';
import { RiskRephraseService } from './services/risk-rephrase.service';
import { RiskVisibilityService } from './services/risk-visibility.service';
import {
  AnnotateRiskDto,
  ApplyRephraseDto,
  EditProposalDto,
  CreateRiskRuleDto,
  OverrideRiskDto,
  SetClauseVisibilityDto,
  UpdateRiskStatusDto,
} from './dto';

@Controller('risk-analysis')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskAnalysisController {
  constructor(
    private readonly riskAnalysisService: RiskAnalysisService,
    // Phase 7.17 — Prompt 1, B.3: handles PATCH :id/override below.
    private readonly riskOverride: RiskOverrideService,
    // Phase 7.17 — Prompt 1, B.5: handles GET :id/explanation below.
    private readonly riskExplanation: RiskExplanationService,
    // Risk-tab rework — STEP 3: AI clause re-phrase (dispatch / poll / apply).
    private readonly riskRephrase: RiskRephraseService,
    // Risk-tab clutter reduction — per-clause visible set (swap) + completeness.
    private readonly riskVisibility: RiskVisibilityService,
  ) {}

  @Get('contract/:contractId')
  async getByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: User,
  ) {
    // Tenant-isolation Tier 2 — service walls URL contractId against
    // caller's org.
    return this.riskAnalysisService.getByContract(contractId, user.organization_id);
  }

  // ─── Risk-tab clutter reduction — top-2 visible + swap + completeness ──

  /** Per-clause swap overrides for a contract: { [clauseId]: [visibleId,visibleId] }. */
  @Get('contract/:contractId/visibility')
  async getVisibility(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: User,
  ) {
    return this.riskVisibility.getOverrides(contractId, user.organization_id);
  }

  /** Annotation completeness = every VISIBLE risk (top-2 after swaps) verified. */
  @Get('contract/:contractId/completeness')
  async getCompleteness(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: User,
  ) {
    return this.riskVisibility.getCompleteness(contractId, user.organization_id);
  }

  /** Persist a SWAP — the 2 chosen visible risk ids for a clause. */
  @Put('clause/:contractClauseId/visibility')
  async setVisibility(
    @Param('contractClauseId', ParseUUIDPipe) contractClauseId: string,
    @Body() dto: SetClauseVisibilityDto,
    @CurrentUser() user: User,
  ) {
    return this.riskVisibility.setVisibility(
      contractClauseId,
      dto.visible_risk_ids,
      user.organization_id,
      user.id,
    );
  }

  @Get('contract/:contractId/summary')
  async getRiskSummary(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: User,
  ) {
    return this.riskAnalysisService.getRiskSummary(contractId, user.organization_id);
  }

  @Get('clause/:clauseId')
  async getByClause(
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
    @CurrentUser() user: User,
  ) {
    // Tenant-isolation — service walls the clause's contract against the
    // caller's org (pre-S2e stop-gap).
    return this.riskAnalysisService.getByClause(
      clauseId,
      user.organization_id,
    );
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRiskStatusDto,
    @CurrentUser() user: any,
  ) {
    // Tenant-isolation — service walls the risk's contract against the
    // caller's org BEFORE the status mutation (pre-S2e stop-gap).
    return this.riskAnalysisService.updateRiskStatus(
      id,
      dto,
      user.id,
      user.organization_id,
    );
  }

  /**
   * Phase 7.17 — Prompt 1, B.3.
   *
   * Apply a user override to an existing RiskAnalysis row's
   * Likelihood / Impact. OWNER_ADMIN only — OWNER_REVIEWER can
   * request changes via comments (existing functionality) but cannot
   * directly override. Returns 404 when the risk doesn't belong to the
   * caller's organisation. Returns the updated risk plus an optional
   * drift_warning payload when the override pulls L or I more than 2
   * points below the current resolved default (warn-only — server
   * never rejects on drift grounds).
   */
  @Patch(':id/override')
  @Roles(UserRole.OWNER_ADMIN)
  async overrideRisk(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideRiskDto,
    @CurrentUser() user: User,
  ) {
    return this.riskOverride.applyOverride({
      riskId: id,
      userId: user.id,
      orgId: user.organization_id,
      likelihood: dto.likelihood,
      impact: dto.impact,
      note: dto.note,
    });
  }

  /**
   * Phase 8.3 — editable Risk Analysis tab. Human correction of a finding's
   * `risk_level` and/or `risk_category`. Org-walled (404 cross-tenant) in the
   * service; open to any authenticated org member — matching the
   * `PUT :id/status` precedent (no `@Roles`). Snapshots the AI original on the
   * first edit; touches ONLY the label layer (never L/I / the override/drift
   * machinery).
   *
   * NOTE: `:id` matches a single path segment, so it does NOT collide with
   * `:id/override` (two segments); `ParseUUIDPipe` further restricts it to
   * UUIDs, so it never shadows the static `rules` / `categories` routes.
   */
  @Patch(':id')
  async annotate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnotateRiskDto,
    @CurrentUser() user: User,
  ) {
    return this.riskAnalysisService.annotateRisk(
      id,
      dto,
      user.id,
      user.organization_id,
    );
  }

  /**
   * Risk-tab rework — STEP 3: AI clause re-phrase.
   *
   * `POST :id/rephrase` dispatches the AI rewrite job for the risk's clause and
   * returns a `job_id` to poll. `GET :id/rephrase/status?job_id=` polls it and,
   * on completion, creates + returns the proposed replacement for the merge
   * preview. `POST :id/rephrase/apply` promotes (accept) or discards (reject).
   * All org-walled in the service (404 cross-tenant); any authenticated org
   * member, matching the annotate / status precedent (no `@Roles`).
   *
   * `:id/rephrase*` are multi-segment routes, so they never collide with the
   * single-segment `PATCH :id`; `ParseUUIDPipe` restricts `:id` to UUIDs.
   */
  @Post(':id/rephrase')
  async startRephrase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.riskRephrase.startRephrase(id, user.organization_id);
  }

  @Get(':id/rephrase/status')
  async pollRephrase(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('job_id') jobId: string,
    @CurrentUser() user: User,
  ) {
    return this.riskRephrase.pollRephrase(id, jobId, user.organization_id);
  }

  @Post(':id/rephrase/edit')
  async editProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditProposalDto,
    @CurrentUser() user: User,
  ) {
    return this.riskRephrase.editProposal(id, dto, user.organization_id);
  }

  @Post(':id/rephrase/apply')
  async applyRephrase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyRephraseDto,
    @CurrentUser() user: User,
  ) {
    return this.riskRephrase.applyRephrase(
      id,
      dto.action,
      user.organization_id,
      user.id,
      // TASK 3 — checkbox is checked by default; default to true when omitted.
      dto.mark_handled ?? true,
    );
  }

  /**
   * Phase 7.17 — Prompt 1, B.5.
   *
   * Full provenance of one finding's current L,I for the F.1 "why?"
   * popover: the stored values + sources, a live resolver snapshot (what
   * would resolve now for a fresh finding in this org+category, with APA
   * citation or learned-baseline count), and the override history.
   *
   * No `@Roles` — any authenticated user may read; the service enforces
   * org ownership via the contract→project→org join (404 when the finding
   * isn't in the caller's organisation), matching B.3's pattern.
   */
  @Get(':id/explanation')
  async getExplanation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.riskExplanation.getExplanation(id, user.organization_id);
  }

  @Get('rules')
  async getRules(@Query('active_only') activeOnly?: string) {
    return this.riskAnalysisService.getRules(
      activeOnly !== 'false',
    );
  }

  @Post('rules')
  @Roles(UserRole.SYSTEM_ADMIN)
  async createRule(
    @Body() dto: CreateRiskRuleDto,
    @CurrentUser() user: any,
  ) {
    return this.riskAnalysisService.createRule(dto, user.id);
  }

  @Put('rules/:id')
  @Roles(UserRole.SYSTEM_ADMIN)
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateRiskRuleDto> & { is_active?: boolean },
  ) {
    return this.riskAnalysisService.updateRule(id, dto);
  }

  @Delete('rules/:id')
  @Roles(UserRole.SYSTEM_ADMIN)
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    await this.riskAnalysisService.deleteRule(id);
    return { message: 'Risk rule deactivated' };
  }

  @Get('categories')
  async getCategories() {
    return this.riskAnalysisService.getCategories();
  }
}
