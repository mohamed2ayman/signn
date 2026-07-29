import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { PlaybookService } from './playbook.service';
import { CreatePlaybookPositionDto } from './dto/create-playbook-position.dto';
import { UpdatePlaybookPositionDto } from './dto/update-playbook-position.dto';

/**
 * 7.22 Slice 1 — the org's Contract Playbook (standard positions).
 *
 * Org-scoped: the org id comes from the JWT (`@OrganizationId()`), never from
 * the body or a query param, and the service carries it into every query.
 *
 * OWNER_ADMIN-gated per NEXT_PHASES 7.22 — "Build Playbook section in Settings
 * (org-level, OWNER_ADMIN only)" — which is also exactly the ERP connections
 * precedent. NOTE `RolesGuard` is EXACT-match membership, not a hierarchy: this
 * surface is OWNER_ADMIN and nobody else, SYSTEM_ADMIN included.
 */
@Controller('playbook/positions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER_ADMIN)
export class PlaybookController {
  constructor(private readonly service: PlaybookService) {}

  @Post()
  create(
    @OrganizationId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePlaybookPositionDto,
  ) {
    return this.service.create(orgId, userId ?? null, dto);
  }

  @Get()
  list(@OrganizationId() orgId: string) {
    return this.service.list(orgId);
  }

  @Get(':id')
  getOne(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getOne(orgId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaybookPositionDto,
  ) {
    return this.service.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @OrganizationId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(orgId, id);
  }
}
