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
import { ObligationsService } from './obligations.service';
import { CreateObligationDto, UpdateObligationDto } from './dto';

@Controller('obligations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ObligationsController {
  constructor(private readonly obligationsService: ObligationsService) {}

  @Get('contract/:contractId')
  async findByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.obligationsService.findByContract(contractId);
  }

  @Get('upcoming')
  async getUpcoming(@Query('days') days?: string) {
    return this.obligationsService.getUpcoming(
      days ? parseInt(days, 10) : 30,
    );
  }

  @Get('overdue')
  async getOverdue() {
    return this.obligationsService.getOverdue();
  }

  @Get('dashboard')
  async getDashboard(@Query('contract_id') contractId?: string) {
    return this.obligationsService.getDashboard(contractId);
  }

  // UUID regex constraint prevents static segments like "portfolio" and "calendar"
  // (registered in ComplianceObligationsController) from being swallowed by this
  // dynamic route. ParseUUIDPipe still validates the value after matching.
  // Fix for Phase 7.2-G — obligation route shadowing.
  @Get(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.obligationsService.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateObligationDto) {
    return this.obligationsService.create(dto);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObligationDto,
  ) {
    return this.obligationsService.update(id, dto);
  }

  @Put(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { evidence_url?: string },
    @CurrentUser() user: any,
  ) {
    return this.obligationsService.complete(id, user.id, body.evidence_url);
  }

  @Delete(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.obligationsService.delete(id);
    return { message: 'Obligation deleted successfully' };
  }
}
 
