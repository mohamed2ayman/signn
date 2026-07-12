import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ContractParty } from '../../database/entities';
import { ContractPartiesService } from './contract-parties.service';
import { CreateContractPartyDto, UpdateContractPartyDto } from './dto';

/**
 * Multi-tier trunk — Slice T0c-1. Contract-scoped party routes
 * (the /contracts/:contractId/compliance-checks convention).
 *
 * Contacts are EMBEDDED in the party payload (create/update carry the full
 * contacts array; update !== undefined = full replace) — no nested contact
 * routes, so the designated-signatory invariant is validated atomically.
 *
 * Tenancy + pin enforcement live in the SERVICE (findInOrg wall first,
 * assertContractMutable second) — never here (controller guards would miss
 * non-HTTP writers; lesson #225 posture).
 */
@Controller('contracts/:contractId/parties')
@UseGuards(JwtAuthGuard)
export class ContractPartiesController {
  constructor(
    private readonly contractPartiesService: ContractPartiesService,
  ) {}

  @Get()
  async list(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @OrganizationId() orgId: string,
  ): Promise<ContractParty[]> {
    return this.contractPartiesService.list(contractId, orgId);
  }

  @Post()
  async create(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @OrganizationId() orgId: string,
    @Body() dto: CreateContractPartyDto,
  ): Promise<ContractParty> {
    return this.contractPartiesService.create(contractId, orgId, dto);
  }

  @Put(':partyId')
  async update(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('partyId', ParseUUIDPipe) partyId: string,
    @OrganizationId() orgId: string,
    @Body() dto: UpdateContractPartyDto,
  ): Promise<ContractParty> {
    return this.contractPartiesService.update(contractId, partyId, orgId, dto);
  }

  @Delete(':partyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('partyId', ParseUUIDPipe) partyId: string,
    @OrganizationId() orgId: string,
  ): Promise<void> {
    await this.contractPartiesService.remove(contractId, partyId, orgId);
  }
}
