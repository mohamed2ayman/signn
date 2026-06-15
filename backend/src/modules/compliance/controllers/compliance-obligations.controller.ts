import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../../common/guards/permission-level.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Obligation, ObligationStatus, PermissionLevel, User } from '../../../database/entities';
import { IcalExportService } from '../services/ical-export.service';
import { ComplianceObligationService } from '../services/compliance-obligation.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
// Option B — S2c-1: the ical LIST read loads through the scoped-repository
// tenancy chokepoint (canonical obligation→contract→project→org), UNDER the
// #60 assertContractInCallerOrg wall — two checks, two layers.
import { ObligationScopedRepository } from '../../scoped-repository/obligation-scoped.repository';
import { ObligationFiltersDto } from '../dto/obligation-filters.dto';
import { UpdateObligationInlineDto } from '../dto/update-obligation-inline.dto';
import { AssignObligationDto } from '../dto/assign-obligation.dto';
import { UpdateEvidenceDto } from '../dto/update-evidence.dto';
import { ObligationPortfolioFiltersDto } from '../dto/obligation-portfolio-filters.dto';
import { ObligationCalendarQueryDto } from '../dto/obligation-calendar-query.dto';

/** One year in milliseconds — max calendar range. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class ComplianceObligationsController {
  constructor(
    @InjectRepository(Obligation) // lint-exempt: wall-protected (findInOrg + obligationScoped)
    private readonly obligationRepo: Repository<Obligation>,
    private readonly ical: IcalExportService,
    private readonly obligationSvc: ComplianceObligationService,
    // INTERIM (S0): Class-C bypass-role wall for listForContract.
    private readonly contractAccess: ContractAccessService,
    // S2c-1: data-layer tenancy load for the ical read. S2c-2: the by-id
    // loads (loadObligationInContract → PATCH update / assign / unassign /
    // evidence / reminders) also load through it. The remaining bare
    // obligationRepo uses (the listForContract/listForProject QBs, the PATCH
    // save) stay raw per Q3 — the lint bucket.
    private readonly obligationScoped: ObligationScopedRepository,
  ) {}

  /**
   * INTERIM (S0): Class-C bypass-role wall. Option B will absorb this via the
   *  scoped repository chokepoint — this findInOrg is the stop-gap until then.
   * 404 (not 403) on cross-tenant or no-org callers — no existence leak,
   * matching the findInOrg convention used by the sibling ComplianceController.
   */
  private async assertContractInCallerOrg(
    contractId: string,
    user: User,
  ): Promise<void> {
    if (!user.organization_id) {
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, user.organization_id);
  }

  /**
   * Obligation-in-contract load. Option B S2c-2: loads through the
   * scoped-repository chokepoint (layer 2) — the canonical
   * obligation→contract→project→org join with the URL contract as a
   * NARROWING pin (`obligation.contract_id = :contractIdOverride`; the pin
   * can never widen or change the caller's org). Replaces the bare findOne +
   * manual pin. 404 (never 403) on miss, contract mismatch, or cross-org —
   * no existence leak. Always call AFTER the org wall (layer 1), never
   * instead of it; the wall guarantees `orgId` is non-null here.
   */
  private async loadObligationInContract(
    obligationId: string,
    contractId: string,
    orgId: string,
  ): Promise<Obligation> {
    return this.obligationScoped.scopedFindByIdViaContractOrThrow(
      obligationId,
      orgId,
      { contractIdOverride: contractId },
    );
  }

  // ─── Existing Phase 3.4 endpoints ────────────────────────────────────────

  @Get('contracts/:contractId/obligations')
  @RequirePermission(PermissionLevel.VIEWER)
  async listForContract(
    @Param('contractId') contractId: string,
    @Query() filters: ObligationFiltersDto,
    @CurrentUser() user: User,
  ): Promise<Obligation[]> {
    // INTERIM (S0): Class-C bypass-role wall. Option B will absorb this via the
    //  scoped repository chokepoint — this findInOrg is the stop-gap until then.
    await this.assertContractInCallerOrg(contractId, user);
    return this.applyFilters(
      this.obligationRepo // lint-exempt: aggregation QB (Q3 — obligation list)
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.assignees', 'oa')
        .leftJoinAndSelect('oa.user', 'au')
        .where('o.contract_id = :contractId', { contractId }),
      filters,
    )
      .orderBy('o.due_date', 'ASC')
      .getMany();
  }

  @Patch('contracts/:contractId/obligations/:obligationId')
  @RequirePermission(PermissionLevel.EDITOR)
  async update(
    @Param('contractId') contractId: string,
    @Param('obligationId') id: string,
    @Body() body: UpdateObligationInlineDto,
    @CurrentUser() user: User,
  ): Promise<Obligation> {
    // WALL (persona — #60, layer 1): contract-in-org, unchanged.
    await this.assertContractInCallerOrg(contractId, user);
    // SCOPED LOAD (tenancy — Option B S2c-2, layer 2): by-id through the
    // canonical org join with the contract pin. The save below operates on
    // the scoped-loaded row.
    const o = await this.loadObligationInContract(
      id,
      contractId,
      user.organization_id,
    );
    Object.assign(o, body);
    if (
      (body.status === ObligationStatus.MET ||
        body.status === ObligationStatus.COMPLETED) &&
      !o.completed_at
    ) {
      o.completed_at = new Date();
      o.completed_by = user.id;
    }
    return this.obligationRepo.save(o); // lint-exempt: wall-protected (findInOrg + obligationScoped)
  }

  @Get('contracts/:contractId/obligations/ical')
  @RequirePermission(PermissionLevel.VIEWER)
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async icalForContract(
    @Param('contractId') contractId: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    // WALL (persona) — #60's org wall on the list read, unchanged (layer 1).
    await this.assertContractInCallerOrg(contractId, user);
    // SCOPED LIST (tenancy — Option B S2c-1, layer 2): the rows load through
    // the scoped repo, which independently re-applies the canonical
    // obligation→contract→project→org join. The wall above guarantees
    // user.organization_id is non-null here.
    const items = await this.obligationScoped.scopedFind(
      { contract_id: contractId },
      user.organization_id,
      { relations: ['contract'] },
    );
    const name = items[0]?.contract?.name
      ? `SIGN — ${items[0].contract.name}`
      : 'SIGN Obligations';
    const ics = this.ical.build({ name, obligations: items });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sign-obligations-${contractId}.ics"`,
    );
    res.send(ics);
  }

  @Get('projects/:projectId/obligations')
  @RequirePermission(PermissionLevel.VIEWER)
  async listForProject(
    @Param('projectId') projectId: string,
    @Query() filters: ObligationFiltersDto,
    @CurrentUser() user: User,
  ): Promise<Obligation[]> {
    // PRE-S2c HOTFIX: org wall. The URL's project_id is denormalized and was
    // trusted bare — bypass roles skipped the membership guard, so any
    // authenticated caller could list a foreign project's obligations. The
    // canonical contract→project org join narrows the read to the caller's
    // org; a no-org caller gets nothing (no existence leak either way).
    if (!user.organization_id) {
      return [];
    }
    return this.applyFilters(
      this.obligationRepo // lint-exempt: aggregation QB (Q3 — obligation list)
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.contract', 'c')
        .leftJoinAndSelect('o.assignees', 'oa')
        .leftJoinAndSelect('oa.user', 'au')
        .leftJoin('c.project', 'p')
        .where('o.project_id = :projectId', { projectId })
        .andWhere('p.organization_id = :orgId', {
          orgId: user.organization_id,
        }),
      filters,
    )
      .orderBy('o.due_date', 'ASC')
      .getMany();
  }

  // ─── Phase 7.1 — Assignee management ─────────────────────────────────────

  /**
   * POST /contracts/:contractId/obligations/:obligationId/assign
   * Assign a user to an obligation. Returns 409 if already assigned.
   * EDITOR required — assigning responsibility is a write operation.
   */
  @Post('contracts/:contractId/obligations/:obligationId/assign')
  @RequirePermission(PermissionLevel.EDITOR)
  async assignUser(
    @Param('contractId') contractId: string,
    @Param('obligationId') obligationId: string,
    @Body() body: AssignObligationDto,
    @CurrentUser() user: User,
  ) {
    // WALL (#60, layer 1) + SCOPED LOAD (S2c-2, layer 2).
    await this.assertContractInCallerOrg(contractId, user);
    await this.loadObligationInContract(
      obligationId,
      contractId,
      user.organization_id,
    );
    return this.obligationSvc.assignUser(
      obligationId,
      body.user_id,
      user.id,
      user.organization_id,
    );
  }

  /**
   * DELETE /contracts/:contractId/obligations/:obligationId/assign/:userId
   * Remove a user's assignment from an obligation.
   * EDITOR required — modifying assignee membership is a write operation.
   */
  @Delete('contracts/:contractId/obligations/:obligationId/assign/:userId')
  @RequirePermission(PermissionLevel.EDITOR)
  @HttpCode(204)
  async unassignUser(
    @Param('contractId') contractId: string,
    @Param('obligationId') obligationId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    // WALL (#60, layer 1) + SCOPED LOAD (S2c-2, layer 2).
    await this.assertContractInCallerOrg(contractId, user);
    await this.loadObligationInContract(
      obligationId,
      contractId,
      user.organization_id,
    );
    await this.obligationSvc.unassignUser(
      obligationId,
      userId,
      user.organization_id,
    );
  }

  /**
   * PUT /contracts/:contractId/obligations/:obligationId/evidence
   * Attach an evidence URL to an obligation.
   * EDITOR required — evidence is part of obligation completion state.
   */
  @Put('contracts/:contractId/obligations/:obligationId/evidence')
  @RequirePermission(PermissionLevel.EDITOR)
  async updateEvidence(
    @Param('contractId') contractId: string,
    @Param('obligationId') obligationId: string,
    @Body() body: UpdateEvidenceDto,
    @CurrentUser() user: User,
  ): Promise<Obligation> {
    // WALL (#60, layer 1) + SCOPED LOAD (S2c-2, layer 2).
    await this.assertContractInCallerOrg(contractId, user);
    await this.loadObligationInContract(
      obligationId,
      contractId,
      user.organization_id,
    );
    return this.obligationSvc.updateEvidence(
      obligationId,
      body.evidence_url,
      user.organization_id,
    );
  }

  // ─── Phase 7.2-C — Reminder history ──────────────────────────────────────

  /**
   * GET /contracts/:contractId/obligations/:obligationId/reminders
   * Returns reminder log entries for one obligation, most-recent first.
   * Verifies the obligation belongs to the contract before returning data.
   */
  @Get('contracts/:contractId/obligations/:obligationId/reminders')
  @RequirePermission(PermissionLevel.VIEWER)
  async getReminderLogs(
    @Param('contractId') contractId: string,
    @Param('obligationId') obligationId: string,
    @CurrentUser() user: User,
  ) {
    // WALL (#60, layer 1): contract-in-org, unchanged.
    await this.assertContractInCallerOrg(contractId, user);
    // SCOPED PARENT LOAD (S2c-2, layer 2): org + contract proven on the
    // PARENT obligation via the scoped chokepoint; the grandchild log list
    // below is then keyed by the VALIDATED obligation id (two-step — no
    // grandchild scoped subclass, per the S2c plan).
    const obligation = await this.loadObligationInContract(
      obligationId,
      contractId,
      user.organization_id,
    );
    const logs = await this.obligationSvc.getReminderLogs(obligation.id);
    return logs.map((l) => ({
      id: l.id,
      reminder_type: l.reminder_type,
      sent_to: l.sent_to,
      sent_at: l.sent_at,
      email_status: l.email_status,
    }));
  }

  // ─── Phase 7.1 — Portfolio & Calendar ────────────────────────────────────

  /**
   * GET /obligations/portfolio
   * Org-scoped cross-contract obligation portfolio.
   * Optional filters: from, to, project_id, status, type, assignee.
   *
   * No @RequirePermission — org-wide endpoint, no project context.
   * JwtAuthGuard + RolesGuard are sufficient.
   */
  @Get('obligations/portfolio')
  async getPortfolio(
    @Query() filters: ObligationPortfolioFiltersDto,
    @CurrentUser() user: User,
  ) {
    return this.obligationSvc.getPortfolio(user.organization_id, filters);
  }

  /**
   * GET /obligations/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Org-scoped calendar events for obligations in the given date range.
   * Max range: 1 year.
   *
   * No @RequirePermission — org-wide endpoint, no project context.
   */
  @Get('obligations/calendar')
  async getCalendar(
    @Query() query: ObligationCalendarQueryDto,
    @CurrentUser() user: User,
  ) {
    const fromMs = new Date(query.from).getTime();
    const toMs = new Date(query.to).getTime();
    if (isNaN(fromMs) || isNaN(toMs) || toMs < fromMs) {
      throw new BadRequestException('`to` must be on or after `from`');
    }
    if (toMs - fromMs > ONE_YEAR_MS) {
      throw new BadRequestException('Calendar range cannot exceed 1 year');
    }
    return this.obligationSvc.getCalendar(user.organization_id, query.from, query.to);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private applyFilters<T>(qb: any, f: ObligationFiltersDto): any {
    if (f.party) qb.andWhere('o.responsible_party = :party', { party: f.party });
    if (f.type) qb.andWhere('o.obligation_type = :type', { type: f.type });
    if (f.status) qb.andWhere('o.status = :status', { status: f.status });
    if (f.from && f.to) {
      qb.andWhere('o.due_date BETWEEN :from AND :to', {
        from: f.from,
        to: f.to,
      });
    } else if (f.from) {
      qb.andWhere('o.due_date >= :from', { from: f.from });
    } else if (f.to) {
      qb.andWhere('o.due_date <= :to', { to: f.to });
    }
    return qb;
  }
}
