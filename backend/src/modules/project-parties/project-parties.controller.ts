import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { UserRole } from '../../database/entities';
import { ProjectPartiesService } from './project-parties.service';
import { CreatePartyDto, UpdatePartyDto } from './dto';

@Controller('project-parties')
@UseGuards(JwtAuthGuard)
export class ProjectPartiesController {
  constructor(
    private readonly projectPartiesService: ProjectPartiesService,
  ) {}

  @Get()
  async findAll(
    @OrganizationId() orgId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.projectPartiesService.findAll(orgId, projectId);
  }

  @Get('types')
  async getPartyTypes() {
    return this.projectPartiesService.getPartyTypes();
  }

  @Post()
  async create(
    @OrganizationId() orgId: string,
    @Body() dto: CreatePartyDto,
  ) {
    return this.projectPartiesService.create(orgId, dto);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.projectPartiesService.findById(id, orgId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.projectPartiesService.update(id, orgId, dto);
  }

  @Post(':id/invite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER_ADMIN, UserRole.OWNER_CREATOR)
  async invite(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.projectPartiesService.invite(id, orgId);
  }
}
