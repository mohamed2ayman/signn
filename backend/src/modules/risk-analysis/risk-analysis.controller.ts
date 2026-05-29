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
import { CreateRiskRuleDto, OverrideRiskDto, UpdateRiskStatusDto } from './dto';

@Controller('risk-analysis')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskAnalysisController {
  constructor(
    private readonly riskAnalysisService: RiskAnalysisService,
    // Phase 7.17 — Prompt 1, B.3: handles PATCH :id/override below.
    private readonly riskOverride: RiskOverrideService,
    // Phase 7.17 — Prompt 1, B.5: handles GET :id/explanation below.
    private readonly riskExplanation: RiskExplanationService,
  ) {}

  @Get('contract/:contractId')
  async getByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.riskAnalysisService.getByContract(contractId);
  }

  @Get('contract/:contractId/summary')
  async getRiskSummary(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.riskAnalysisService.getRiskSummary(contractId);
  }

  @Get('clause/:clauseId')
  async getByClause(
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
  ) {
    return this.riskAnalysisService.getByClause(clauseId);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRiskStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.riskAnalysisService.updateRiskStatus(id, dto, user.id);
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
