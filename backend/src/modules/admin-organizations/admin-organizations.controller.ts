import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { AdminOrganizationsService } from './admin-organizations.service';
import {
  ListOrganizationsQueryDto,
  SuspendOrganizationDto,
  UpdateFeatureFlagsDto,
} from './dto';

@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminOrganizationsController {
  constructor(private readonly service: AdminOrganizationsService) {}

  @Get()
  list(@Query() query: ListOrganizationsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getById(id);
  }

  @Put(':id/suspend')
  suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SuspendOrganizationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.suspend(id, body.reason, user.id);
  }

  @Put(':id/unsuspend')
  unsuspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.unsuspend(id, user.id);
  }

  @Put(':id/feature-flags')
  updateFeatureFlags(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateFeatureFlagsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.updateFeatureFlags(id, body.featureFlags, user.id);
  }
}
