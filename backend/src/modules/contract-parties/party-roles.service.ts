import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PartyRole } from '../../database/entities';

/**
 * Multi-tier trunk — Slice T0c-1. Read-side of the party-role registry.
 *
 * The registry (party_roles, seeded by migration 1770000000001) is the
 * SINGLE SOURCE for party-role codes + labels ×3 locales. Two consumers:
 *  - GET /party-roles (the frontend picker reads labels + metadata from
 *    here — no FE/BE metadata duplication; mirrors
 *    ContractRelationshipTypesService).
 *  - ContractPartiesService validates contract_parties.role_code via
 *    findByCode().
 *
 * Registry rows are global reference data (no organization_id) — org-scoping
 * does not apply here.
 */
@Injectable()
export class PartyRolesService {
  constructor(
    @InjectRepository(PartyRole)
    private readonly partyRoleRepository: Repository<PartyRole>,
  ) {}

  /**
   * List registry rows ordered by sort_order. Default: ACTIVE only.
   * includeInactive=true additionally returns inactive rows (admin surfaces).
   * appliesTo='contract' | 'project' narrows to rows usable in that scope
   * (the named scope + 'both') — the contract-party picker passes 'contract'.
   */
  async findAll(
    includeInactive = false,
    appliesTo?: 'project' | 'contract',
  ): Promise<PartyRole[]> {
    const where: Record<string, unknown> = {};
    if (!includeInactive) {
      where.is_active = true;
    }
    if (appliesTo) {
      where.applies_to = In([appliesTo, 'both']);
    }
    return this.partyRoleRepository.find({
      where,
      order: { sort_order: 'ASC' },
    });
  }

  /**
   * Resolve a registry row by code — ANY row, active or not. The caller
   * (ContractPartiesService) branches on is_active / applies_to so it can
   * produce specific 400 messages.
   */
  async findByCode(code: string): Promise<PartyRole | null> {
    return this.partyRoleRepository.findOne({ where: { code } });
  }
}
