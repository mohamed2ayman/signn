import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractRelationshipType } from '../../database/entities';

/**
 * Multi-tier trunk — Slice T0a. Read-side of the relationship-type registry.
 *
 * The registry (contract_relationship_types, seeded by migration
 * 1768000000001) is the SINGLE SOURCE for relationship-type codes + per-type
 * metadata. Two consumers:
 *  - GET /contract-relationship-types (the frontend picker reads labels +
 *    metadata from here — no FE/BE metadata duplication).
 *  - ContractsService.create() validates CreateContractDto.relationship_type
 *    via findActiveByCode().
 *
 * Registry rows are global reference data (no organization_id) — org-scoping
 * does not apply here.
 */
@Injectable()
export class ContractRelationshipTypesService {
  constructor(
    @InjectRepository(ContractRelationshipType)
    private readonly relationshipTypeRepository: Repository<ContractRelationshipType>,
  ) {}

  /**
   * List registry rows ordered by sort_order. Default: ACTIVE only (what the
   * create-flow picker consumes). includeInactive=true additionally returns
   * the seeded "coming soon" types (JOINT_VENTURE / FRAMEWORK / NOVATION) —
   * for admin surfaces or a greyed-out "coming soon" display.
   */
  async findAll(includeInactive = false): Promise<ContractRelationshipType[]> {
    return this.relationshipTypeRepository.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC' },
    });
  }

  /**
   * Resolve an ACTIVE registry row by code. Returns null for unknown codes
   * AND for inactive ("coming soon") codes — callers treat both as invalid.
   */
  async findActiveByCode(code: string): Promise<ContractRelationshipType | null> {
    return this.relationshipTypeRepository.findOne({
      where: { code, is_active: true },
    });
  }
}
