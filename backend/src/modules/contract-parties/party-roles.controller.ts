import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PartyRolesService } from './party-roles.service';
import { PartyRole } from '../../database/entities';

/**
 * Multi-tier trunk — Slice T0c-1.
 *
 * GET /party-roles — the ONE endpoint serving the party-role registry
 * (codes + labels ×3 locales + applies_to scope). Mirrors
 * GET /contract-relationship-types.
 *
 * Default returns ACTIVE rows only. ?include_inactive=true additionally
 * returns inactive rows. ?applies_to=contract returns only rows usable on
 * contracts (applies_to IN ('contract','both')) — the contract-party picker
 * set; ?applies_to=project is the symmetric project-side filter.
 *
 * JwtAuthGuard only — registry rows are global reference data (no org
 * scoping, no role gate; any authenticated user may read them).
 */
@Controller('party-roles')
@UseGuards(JwtAuthGuard)
export class PartyRolesController {
  constructor(private readonly partyRolesService: PartyRolesService) {}

  @Get()
  async list(
    @Query('include_inactive') includeInactive?: string,
    @Query('applies_to') appliesTo?: string,
  ): Promise<PartyRole[]> {
    const scope =
      appliesTo === 'contract' || appliesTo === 'project'
        ? appliesTo
        : undefined;
    return this.partyRolesService.findAll(includeInactive === 'true', scope);
  }
}
