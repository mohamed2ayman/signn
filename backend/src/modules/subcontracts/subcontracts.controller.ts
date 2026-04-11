import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubContractsService } from './subcontracts.service';
import { CreateSubContractDto, UpdateSubContractDto, UpdateSubContractStatusDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { User } from '../../database/entities';

@Controller('subcontracts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class SubContractsController {
  constructor(private readonly subContractsService: SubContractsService) {}

  @Post()
  async create(
    @Body() dto: CreateSubContractDto,
    @CurrentUser() user: User,
    @OrganizationId() orgId: string,
  ) {
    return this.subContractsService.create(dto, user.id, orgId);
  }

  @Get()
  async findAllByMainContract(
    @Query('main_contract_id') mainContractId: string,
  ) {
    return this.subContractsService.findAllByMainContract(mainContractId);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.subContractsService.findById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubContractDto,
    @CurrentUser() user: User,
  ) {
    return this.subContractsService.update(id, dto, user.id);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSubContractStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.subContractsService.updateStatus(id, dto, user.id);
  }

  @Post(':id/share')
  async share(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.subContractsService.share(id, user.id);
  }
}
