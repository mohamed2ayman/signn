import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ContractRelationshipTypesService } from './contract-relationship-types.service';
import { ContractRelationshipType } from '../../database/entities';

/**
 * Multi-tier trunk — Slice T0a.
 *
 * GET /contract-relationship-types — the ONE endpoint serving the
 * relationship-type registry (codes + labels ×3 locales + per-type metadata)
 * so frontend and backend read a single source (no isStandardForm-style
 * helper duplication).
 *
 * Default returns ACTIVE rows only (the create-flow picker set).
 * ?include_inactive=true additionally returns the seeded "coming soon"
 * types — for admin views or greyed-out picker entries (T0a.2's call).
 *
 * JwtAuthGuard only — registry rows are global reference data (no org
 * scoping, no role gate; any authenticated user may read them).
 */
@Controller('contract-relationship-types')
@UseGuards(JwtAuthGuard)
export class ContractRelationshipTypesController {
  constructor(
    private readonly relationshipTypesService: ContractRelationshipTypesService,
  ) {}

  @Get()
  async list(
    @Query('include_inactive') includeInactive?: string,
  ): Promise<ContractRelationshipType[]> {
    return this.relationshipTypesService.findAll(includeInactive === 'true');
  }
}
