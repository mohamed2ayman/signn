import api from './axios';
import type { ContractParty, PartyRole } from '@/types';

/**
 * Multi-tier T0c-2 — frontend client for the T0c-1 ContractParty API.
 *
 * Endpoints (all org-walled server-side via ContractAccessService.findInOrg,
 * cross-org → 404; party mutations floored at EDITOR):
 *   GET    /party-roles?applies_to=contract        — the role registry picker source
 *   GET    /contracts/:contractId/parties          — list parties (contacts embedded)
 *   POST   /contracts/:contractId/parties          — create (contacts embedded)
 *   PUT    /contracts/:contractId/parties/:partyId — update (contacts = full replace)
 *   DELETE /contracts/:contractId/parties/:partyId — delete (contacts CASCADE)
 *
 * Role labels come straight from the registry rows (label_en/ar/fr) — never
 * hardcoded here (mirrors the contract-relationship-types picker).
 */

/** Contact person in a create/update party payload (embedded). */
export interface PartyContactPayload {
  name: string;
  email: string;
  title?: string | null;
  is_designated_signatory?: boolean;
}

/** POST body — create a party (mirrors CreateContractPartyDto). */
export interface CreatePartyPayload {
  role_code: string;
  org_name: string;
  is_signatory?: boolean;
  organization_id?: string | null;
  legal_tax_card?: string | null;
  legal_address?: string | null;
  contacts?: PartyContactPayload[];
}

/** PUT body — update a party (mirrors UpdateContractPartyDto; contacts = full replace). */
export type UpdatePartyPayload = Partial<CreatePartyPayload>;

export const partyService = {
  /**
   * Party-role registry for the contract-party picker. `applies_to=contract`
   * returns rows where applies_to IN ('contract','both') — active only by
   * default. Labels are read by the active locale in the picker.
   */
  getRoles: (appliesTo: 'contract' | 'project' = 'contract') =>
    api
      .get<PartyRole[]>('/party-roles', { params: { applies_to: appliesTo } })
      .then((r) => r.data),

  list: (contractId: string) =>
    api
      .get<ContractParty[]>(`/contracts/${contractId}/parties`)
      .then((r) => r.data),

  create: (contractId: string, data: CreatePartyPayload) =>
    api
      .post<ContractParty>(`/contracts/${contractId}/parties`, data)
      .then((r) => r.data),

  update: (contractId: string, partyId: string, data: UpdatePartyPayload) =>
    api
      .put<ContractParty>(`/contracts/${contractId}/parties/${partyId}`, data)
      .then((r) => r.data),

  remove: (contractId: string, partyId: string) =>
    api
      .delete(`/contracts/${contractId}/parties/${partyId}`)
      .then((r) => r.data),
};

export default partyService;
