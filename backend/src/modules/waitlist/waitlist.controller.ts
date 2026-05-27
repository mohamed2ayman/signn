import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ThrottleOnly } from '../../common/decorators/throttle-only.decorator';
import { stripHtml } from '../../common/utils/sanitize';
import { UserRole } from '../../database/entities';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';

@Controller()
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  /**
   * POST /waitlist — public, unauthenticated.
   *
   * Rate-limited to 3 per IP per hour via @ThrottleOnly('waitlist').
   * lesson #67: use @ThrottleOnly, never plain @Throttle — plain @Throttle
   * activates all 9 named throttler buckets, not just 'waitlist'.
   *
   * Always returns 200 { success: true }, including on duplicate email+product.
   * Never returns 409 — that would expose whether the email is already
   * registered (enumeration risk on a public endpoint).
   */
  @Post('waitlist')
  @ThrottleOnly('waitlist')
  async subscribe(
    @Body() dto: CreateWaitlistEntryDto,
  ): Promise<{ success: true }> {
    // Sanitize email against any HTML injection before persisting.
    // Email is also stored lowercased+trimmed inside the service.
    dto.email = stripHtml(dto.email) as string;
    return this.waitlistService.create(dto);
  }

  /**
   * GET /admin/waitlist — SYSTEM_ADMIN only.
   * Returns all entries, optionally filtered by product_name.
   */
  @Get('admin/waitlist')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN)
  getAll(
    @Query('product_name') productName?: string,
  ) {
    return this.waitlistService.findAll(productName);
  }

  /**
   * GET /admin/waitlist/export — SYSTEM_ADMIN only.
   * Returns all rows as JSON; frontend assembles CSV client-side.
   * Follows AdminAuditLogPage.tsx pattern (frontend-assembled CSV).
   * No @Res() injection needed — plain JSON response.
   */
  @Get('admin/waitlist/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN)
  export(
    @Query('product_name') productName?: string,
  ) {
    return this.waitlistService.findAll(productName);
  }
}
