import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ThrottleOnly } from '../../../common/decorators/throttle-only.decorator';
import { User, UserRole } from '../../../database/entities';
import { AnalyticsPeriod } from '../../admin-analytics/dto';
import { PortfolioExportService } from '../services/portfolio-export.service';
import { CreatePortfolioExportDto } from '../dto/create-portfolio-export.dto';

/**
 * POST /api/v1/portfolio-exports — OWNER_ADMIN-only export request.
 *
 * Gated at three layers:
 *   1. JwtAuthGuard            — token must be valid + not blacklisted
 *   2. RolesGuard + OWNER_ADMIN — role gate (matches /portfolio-analytics)
 *   3. @ThrottleOnly('portfolio_export') — 5/15min per IP (Phase 7.17
 *      Prompt 2c D6 — abuse mitigation, NOT capacity limit)
 *
 * Scoping (org_id, user_id, email) is taken from the JWT-derived User
 * object via @CurrentUser — NEVER from the request body. A client-supplied
 * org_id or user_id would bypass the OWNER_ADMIN gate; we don't even read
 * such fields.
 *
 * Returns { job_id, email } so the frontend can show the destination in
 * the confirmation toast ("Your export will be sent to <email>").
 */
@Controller('portfolio-exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PortfolioExportController {
  constructor(private readonly exports: PortfolioExportService) {}

  @Post()
  @HttpCode(202) // Accepted — work is queued, not synchronously complete
  @Roles(UserRole.OWNER_ADMIN)
  @ThrottleOnly('portfolio_export')
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreatePortfolioExportDto,
  ): Promise<{ job_id: string; email: string }> {
    const { jobId } = await this.exports.createJob({
      userId: user.id,
      orgId: user.organization_id,
      projectId: dto.project_id ?? null,
      period: dto.period ?? AnalyticsPeriod.P90,
      // Captured at request time — prevents the email-change race in the
      // processor (Bucket 2 spec). NOT a lookup at email-send time.
      email: user.email,
    });
    return { job_id: jobId, email: user.email };
  }
}
