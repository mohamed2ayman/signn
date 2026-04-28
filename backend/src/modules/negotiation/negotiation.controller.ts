import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { NegotiationService } from './negotiation.service';
import { CreateNegotiationEventDto } from './dto';
import { NegotiationEventSource } from '../../database/entities';

@Controller()
@UseGuards(JwtAuthGuard)
export class NegotiationController {
  constructor(private readonly negotiationService: NegotiationService) {}

  /**
   * Internal write endpoint called by the Word Add-in (and later the web app)
   * after clause-level negotiation actions. The `source` is derived from the
   * `X-Client` header rather than trusted from the body, so callers cannot
   * spoof the origin.
   */
  @Post('negotiation/events')
  @HttpCode(HttpStatus.CREATED)
  async createEvent(
    @Body() dto: CreateNegotiationEventDto,
    @CurrentUser('id') userId: string,
    @OrganizationId() orgId: string,
    @Headers('x-client') clientHeader?: string,
  ) {
    const source =
      clientHeader === 'word-addin'
        ? NegotiationEventSource.WORD_ADDIN
        : NegotiationEventSource.WEB_APP;
    return this.negotiationService.createEvent(dto, userId, orgId, source);
  }

  @Get('contracts/:id/negotiation-history')
  async getHistory(
    @Param('id', ParseUUIDPipe) contractId: string,
    @OrganizationId() orgId: string,
    @Query('clause_ref') clauseRef?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.negotiationService.findHistory(contractId, orgId, {
      clause_ref: clauseRef,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
