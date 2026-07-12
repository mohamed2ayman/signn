import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ContractParty,
  ContractPartyContact,
  Organization,
} from '../../database/entities';
import { ContractAccessService } from '../contracts/services/contract-access.service';
import { assertContractMutable } from '../contracts/utils/contract-pin-guard.util';
import { PartyRolesService } from './party-roles.service';
import { ContractPartyContactDto } from './dto/contract-party-contact.dto';
import { CreateContractPartyDto } from './dto/create-contract-party.dto';
import { UpdateContractPartyDto } from './dto/update-contract-party.dto';

/**
 * Multi-tier trunk — Slice T0c-1. Contract parties CRUD.
 *
 * Ordering contract on EVERY entry point (reads and writes):
 *   1. TENANCY WALL — ContractAccessService.findInOrg(contractId, orgId).
 *      Cross-org resolves 404-not-403 FIRST (no existence leak; the
 *      CONTRACT_PINNED answer must never fire on a cross-org probe).
 *   2. PIN GUARD (mutations only) — assertContractMutable: parties are
 *      SUBSTANTIVE legal content, so party writes on a pinned (signed)
 *      contract reject with the coded 409 CONTRACT_PINNED envelope — the
 *      same service-layer gate as the ~16 existing mutation paths.
 *   3. FIELD VALIDATION (400s) — role_code against the party_roles
 *      registry; organization_id org-scoped; the designated-signatory
 *      invariant.
 *
 * Fields are mapped EXPLICITLY, never spread from the DTO (lesson #231 —
 * this codebase's services do not spread DTOs; a field added only to the
 * DTO must fail loudly in review, not silently persist-or-not).
 *
 * organization_id (v1): only the HOST org itself may be linked. A foreign
 * org id — even a real one — resolves 404 'Organization not found'
 * (existence never leaks). Cross-tenant party links are the unified-
 * membership arc's territory, not this slice.
 */
@Injectable()
export class ContractPartiesService {
  constructor(
    // lint-exempt: wall-protected (findInOrg on every entry point); chokepoint migration scheduled
    @InjectRepository(ContractParty)
    private readonly partyRepository: Repository<ContractParty>,
    // lint-exempt: wall-protected (findInOrg on every entry point); chokepoint migration scheduled
    @InjectRepository(ContractPartyContact)
    private readonly contactRepository: Repository<ContractPartyContact>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly partyRolesService: PartyRolesService,
    private readonly contractAccess: ContractAccessService,
  ) {}

  async list(contractId: string, orgId: string): Promise<ContractParty[]> {
    await this.contractAccess.findInOrg(contractId, orgId);
    // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
    return this.partyRepository.find({
      where: { contract_id: contractId },
      relations: ['contacts'],
      order: { created_at: 'ASC' },
    });
  }

  async create(
    contractId: string,
    orgId: string,
    dto: CreateContractPartyDto,
  ): Promise<ContractParty> {
    const contract = await this.contractAccess.findInOrg(contractId, orgId);
    await assertContractMutable(this.partyRepository.manager, contract);

    await this.assertValidRoleCode(dto.role_code);
    await this.assertOrgLinkInHostOrg(dto.organization_id, orgId);
    this.assertDesignatedSignatoryInvariant(
      dto.is_signatory ?? false,
      dto.contacts,
    );

    return this.partyRepository.manager.transaction(async (em) => {
      const party = em.create(ContractParty, {
        contract_id: contractId,
        role_code: dto.role_code,
        org_name: dto.org_name,
        is_signatory: dto.is_signatory ?? false,
        organization_id: dto.organization_id ?? null,
        legal_tax_card: dto.legal_tax_card ?? null,
        legal_address: dto.legal_address ?? null,
      });
      const saved = await em.save(party);

      if (dto.contacts?.length) {
        const contacts = dto.contacts.map((c) =>
          em.create(ContractPartyContact, {
            contract_party_id: saved.id,
            name: c.name,
            email: c.email,
            title: c.title ?? null,
            is_designated_signatory: c.is_designated_signatory ?? false,
          }),
        );
        await em.save(contacts);
      }

      // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
      return em.findOneOrFail(ContractParty, {
        where: { id: saved.id },
        relations: ['contacts'],
      });
    });
  }

  async update(
    contractId: string,
    partyId: string,
    orgId: string,
    dto: UpdateContractPartyDto,
  ): Promise<ContractParty> {
    const contract = await this.contractAccess.findInOrg(contractId, orgId);
    await assertContractMutable(this.partyRepository.manager, contract);

    // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
    const party = await this.partyRepository.findOne({
      where: { id: partyId, contract_id: contractId },
      relations: ['contacts'],
    });
    if (!party) {
      throw new NotFoundException('Contract party not found');
    }

    if (dto.role_code !== undefined) {
      await this.assertValidRoleCode(dto.role_code);
    }
    if (dto.organization_id !== undefined && dto.organization_id !== null) {
      await this.assertOrgLinkInHostOrg(dto.organization_id, orgId);
    }

    // The designated-signatory invariant is checked against the party's
    // EFFECTIVE post-update state — so flipping is_signatory=false while a
    // designated contact remains (kept or supplied) is rejected too.
    const effectiveSignatory = dto.is_signatory ?? party.is_signatory;
    const effectiveContacts: Array<
      Pick<ContractPartyContactDto, 'is_designated_signatory'>
    > = dto.contacts !== undefined ? dto.contacts : (party.contacts ?? []);
    this.assertDesignatedSignatoryInvariant(
      effectiveSignatory,
      effectiveContacts,
    );

    return this.partyRepository.manager.transaction(async (em) => {
      if (dto.role_code !== undefined) party.role_code = dto.role_code;
      if (dto.org_name !== undefined) party.org_name = dto.org_name;
      if (dto.is_signatory !== undefined) party.is_signatory = dto.is_signatory;
      if (dto.organization_id !== undefined) {
        party.organization_id = dto.organization_id;
      }
      if (dto.legal_tax_card !== undefined) {
        party.legal_tax_card = dto.legal_tax_card;
      }
      if (dto.legal_address !== undefined) {
        party.legal_address = dto.legal_address;
      }
      await em.save(party);

      // contacts !== undefined = FULL REPLACE (embedded-contacts contract).
      if (dto.contacts !== undefined) {
        // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
        await em.delete(ContractPartyContact, { contract_party_id: party.id });
        if (dto.contacts.length) {
          const contacts = dto.contacts.map((c) =>
            em.create(ContractPartyContact, {
              contract_party_id: party.id,
              name: c.name,
              email: c.email,
              title: c.title ?? null,
              is_designated_signatory: c.is_designated_signatory ?? false,
            }),
          );
          await em.save(contacts);
        }
      }

      // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
      return em.findOneOrFail(ContractParty, {
        where: { id: party.id },
        relations: ['contacts'],
      });
    });
  }

  async remove(
    contractId: string,
    partyId: string,
    orgId: string,
  ): Promise<void> {
    const contract = await this.contractAccess.findInOrg(contractId, orgId);
    await assertContractMutable(this.partyRepository.manager, contract);

    // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
    const party = await this.partyRepository.findOne({
      where: { id: partyId, contract_id: contractId },
    });
    if (!party) {
      throw new NotFoundException('Contract party not found');
    }

    // Contacts go with the party (DB ON DELETE CASCADE).
    // lint-exempt: wall-protected (findInOrg above); chokepoint migration scheduled
    await this.partyRepository.delete({ id: party.id });
  }

  /**
   * role_code must exist in the party_roles registry, be ACTIVE, and be
   * usable on contracts (applies_to IN ('contract','both')) — else 400.
   */
  private async assertValidRoleCode(roleCode: string): Promise<void> {
    const role = await this.partyRolesService.findByCode(roleCode);
    if (!role) {
      throw new BadRequestException(
        `Unknown party role code '${roleCode}'. Valid codes come from the party-roles registry (GET /party-roles?applies_to=contract).`,
      );
    }
    if (!role.is_active) {
      throw new BadRequestException(
        `Party role '${roleCode}' is not active and cannot be assigned.`,
      );
    }
    if (role.applies_to !== 'contract' && role.applies_to !== 'both') {
      throw new BadRequestException(
        `Party role '${roleCode}' is a project-level role and cannot be used on a contract party.`,
      );
    }
  }

  /**
   * v1 org link scope: only the caller's own (host) org may be linked.
   * Anything else — including a REAL foreign org — is 404, never 403,
   * so cross-tenant org existence is not leaked.
   */
  private async assertOrgLinkInHostOrg(
    organizationId: string | undefined,
    orgId: string,
  ): Promise<void> {
    if (!organizationId) return;
    if (organizationId !== orgId) {
      throw new NotFoundException('Organization not found');
    }
    const org = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
  }

  /**
   * A designated-signatory contact is only allowed when the party itself
   * is_signatory=true, and at most ONE designated signatory per party.
   */
  private assertDesignatedSignatoryInvariant(
    isSignatory: boolean,
    contacts?: Array<Pick<ContractPartyContactDto, 'is_designated_signatory'>>,
  ): void {
    const designatedCount = (contacts ?? []).filter(
      (c) => c.is_designated_signatory === true,
    ).length;
    if (designatedCount > 0 && !isSignatory) {
      throw new BadRequestException(
        'A designated signatory contact is only allowed on a signatory party (is_signatory=true).',
      );
    }
    if (designatedCount > 1) {
      throw new BadRequestException(
        'A party can have at most one designated signatory contact.',
      );
    }
  }
}
