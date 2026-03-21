import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, AddMemberDto } from './dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(@OrganizationId() orgId: string) {
    return this.projectsService.findAll(orgId);
  }

  @Post()
  async create(
    @OrganizationId() orgId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(orgId, user.id, dto);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.projectsService.findById(id, orgId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, orgId, dto);
  }

  @Get(':id/dashboard')
  async getDashboard(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.projectsService.getDashboard(id, orgId);
  }

  @Post(':id/members')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER_ADMIN, UserRole.OWNER_CREATOR)
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.projectsService.addMember(id, orgId, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER_ADMIN)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @OrganizationId() orgId: string,
  ) {
    return this.projectsService.removeMember(id, userId, orgId);
  }
}
