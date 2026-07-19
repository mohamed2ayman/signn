import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ManagingOrGuestCaller } from '../contracts/services/contract-access.service';
import { RedlineService } from './redline.service';
import {
  AcceptRedlineDto,
  CounterRedlineDto,
  ListRedlinesQueryDto,
  ProposeRedlineDto,
  RejectRedlineDto,
} from './dto/redline.dto';

/**
 * 7.19 Slice 1 — counterparty redlining (managing authenticated surface, NOT
 * /guest/*).
 *
 * Deliberately NO PermissionLevelGuard here: a bound counterparty (Model A —
 * a real MANAGING account holding a "Shared with me" guest_contract_access
 * binding) is NOT a ProjectMember of the host project, so the project-level
 * guard would 403 exactly the persona this feature serves. Authorization
 * lives entirely at the service seam instead, per operation:
 *   propose / list / withdraw → findAccessibleContract (org-first →
 *     binding-fallback; uniform 404 on denial)
 *   accept / reject / counter → findInOrg (HOST-ORG ONLY; uniform 404)
 * — the same seam-not-controller shape as the pin guard (a controller guard
 * would also miss nothing here since every route funnels into the service).
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class RedlineController {
  constructor(private readonly redlines: RedlineService) {}

  private callerOf(user: any): ManagingOrGuestCaller {
    // The exact caller shape contracts.controller feeds
    // findAccessibleContract (organization_id normalized to null — a guest
    // account's org is never read past the own-org branch anyway).
    return {
      id: user.id,
      organization_id: user.organization_id ?? null,
      role: user.role,
      account_type: user.account_type,
    };
  }

  @Post('contracts/:contractId/clauses/:contractClauseId/redlines')
  @HttpCode(HttpStatus.CREATED)
  async propose(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('contractClauseId', ParseUUIDPipe) contractClauseId: string,
    @Body() dto: ProposeRedlineDto,
    @CurrentUser() user: any,
  ) {
    return this.redlines.propose(
      contractId,
      contractClauseId,
      dto,
      this.callerOf(user),
    );
  }

  @Get('contracts/:contractId/redlines')
  async list(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Query() query: ListRedlinesQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.redlines.list(contractId, this.callerOf(user), {
      status: query.status,
      contractClauseId: query.contractClauseId,
    });
  }

  @Post('contracts/:contractId/redlines/:redlineId/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('redlineId', ParseUUIDPipe) redlineId: string,
    @Body() dto: AcceptRedlineDto,
    @CurrentUser() user: any,
  ) {
    return this.redlines.accept(contractId, redlineId, this.callerOf(user), dto);
  }

  @Post('contracts/:contractId/redlines/:redlineId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('redlineId', ParseUUIDPipe) redlineId: string,
    @Body() dto: RejectRedlineDto,
    @CurrentUser() user: any,
  ) {
    return this.redlines.reject(contractId, redlineId, this.callerOf(user), dto);
  }

  @Post('contracts/:contractId/redlines/:redlineId/counter')
  @HttpCode(HttpStatus.CREATED)
  async counter(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('redlineId', ParseUUIDPipe) redlineId: string,
    @Body() dto: CounterRedlineDto,
    @CurrentUser() user: any,
  ) {
    return this.redlines.counter(contractId, redlineId, this.callerOf(user), dto);
  }

  @Post('contracts/:contractId/redlines/:redlineId/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('redlineId', ParseUUIDPipe) redlineId: string,
    @CurrentUser() user: any,
  ) {
    return this.redlines.withdraw(contractId, redlineId, this.callerOf(user));
  }
}
