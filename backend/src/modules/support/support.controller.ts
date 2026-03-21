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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { SupportService } from './support.service';
import { CreateTicketDto, AddReplyDto, UpdateTicketStatusDto } from './dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  async createTicket(
    @CurrentUser() user: any,
    @Body() dto: CreateTicketDto,
  ) {
    return this.supportService.createTicket(
      user.id,
      user.organization_id || null,
      dto,
    );
  }

  @Get('tickets')
  async getMyTickets(@CurrentUser() user: any) {
    return this.supportService.getTicketsByUser(user.id);
  }

  @Get('tickets/:id')
  async getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportService.getTicketById(id);
  }

  @Post('tickets/:id/replies')
  async addReply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: AddReplyDto,
  ) {
    return this.supportService.addReply(
      id,
      user.id,
      dto.content,
      dto.is_internal_note || false,
    );
  }

  // ─── Admin endpoints ───────────────────────────────────

  @Get('admin/tickets')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async getAllTickets(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
  ) {
    return this.supportService.getAllTickets({ status, priority, category });
  }

  @Put('tickets/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.supportService.updateStatus(id, dto.status);
  }

  @Put('tickets/:id/assign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async assignTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { assigned_to: string },
  ) {
    return this.supportService.assignTicket(id, body.assigned_to);
  }
}
