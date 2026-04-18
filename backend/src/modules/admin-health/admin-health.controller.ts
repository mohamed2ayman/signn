import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { AdminHealthService } from './admin-health.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
export class AdminHealthController {
  constructor(private readonly adminHealthService: AdminHealthService) {}

  /**
   * GET /api/v1/admin/health
   * Returns real-time status of all infrastructure services.
   * Restricted to SYSTEM_ADMIN and OPERATIONS roles.
   */
  @Get('health')
  async getHealth() {
    return this.adminHealthService.getHealth();
  }
}
