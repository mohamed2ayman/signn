import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { PermissionDefaultsService } from './permission-defaults.service';
import { UpdatePermissionDefaultDto } from './dto/update-permission-default.dto';

@Controller('permission-defaults')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionDefaultsController {
  constructor(
    private readonly permissionDefaultsService: PermissionDefaultsService,
  ) {}

  /** Get all job titles with their current default permission levels */
  @Get()
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OWNER_ADMIN)
  async getAll() {
    return this.permissionDefaultsService.getAll();
  }

  /** Update the default permission level for a specific job title */
  @Put()
  @Roles(UserRole.SYSTEM_ADMIN)
  async update(@Body() dto: UpdatePermissionDefaultDto) {
    return this.permissionDefaultsService.update(dto);
  }

  /** Reset a job title's default back to hardcoded value */
  @Delete(':jobTitle')
  @Roles(UserRole.SYSTEM_ADMIN)
  async reset(@Param('jobTitle') jobTitle: string) {
    return this.permissionDefaultsService.reset(jobTitle);
  }
}
