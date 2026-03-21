import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ClausesService } from './clauses.service';
import { CreateClauseDto, UpdateClauseDto } from './dto';

@Controller('clauses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClausesController {
  constructor(private readonly clausesService: ClausesService) {}

  @Get()
  async findAll(
    @OrganizationId() orgId: string,
    @Query('clause_type') clauseType?: string,
    @Query('search') search?: string,
    @Query('is_active') isActive?: string,
  ) {
    return this.clausesService.findAll(orgId, {
      clause_type: clauseType,
      search,
      is_active: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('types')
  async getClauseTypes(@OrganizationId() orgId: string) {
    return this.clausesService.getClauseTypes(orgId);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.clausesService.findById(id, orgId);
  }

  @Get(':id/versions')
  async getVersionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    return this.clausesService.getVersionHistory(id, orgId);
  }

  @Post()
  async create(
    @Body() dto: CreateClauseDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.clausesService.create(dto, user.id, orgId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClauseDto,
    @OrganizationId() orgId: string,
  ) {
    return this.clausesService.update(id, dto, orgId);
  }

  @Post(':id/new-version')
  async createNewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClauseDto,
    @CurrentUser() user: any,
    @OrganizationId() orgId: string,
  ) {
    return this.clausesService.createNewVersion(id, dto, user.id, orgId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
  ) {
    await this.clausesService.delete(id, orgId);
    return { message: 'Clause deactivated successfully' };
  }
}
