import api from './axios';

/**
 * #8c Part 4b — HOST-side guest-access management for one contract
 * ("Who has access"). Talks to the host-authorized, org-walled endpoints:
 *
 *   GET  /guest-access/:contractId/guests   — list bindings (active + revoked)
 *   POST /guest-access/:contractId/revoke   — withdraw one guest's access
 *
 * These are HOST routes on the normal authenticated client (managing JWT) —
 * deliberately NOT the isolated `guestHttp` client, which is the guest
 * surface's. Authorization is enforced server-side via findInOrg (cross-org
 * → uniform 404); nothing here passes an org id.
 */

/** Mirrors backend HostGuestBindingRow (contract-access.service.ts). */
export interface HostGuestBindingRow {
  user_id: string;
  guest_email: string;
  guest_name: string | null;
  guest_account_type: string;
  granted_at: string;
  granted_by_name: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
}

/** Mirrors backend GuestBindingRevocation. */
export interface GuestBindingRevocation {
  contract_id: string;
  user_id: string;
  revoked_at: string;
  revoked_by: string | null;
  /** true when the binding was already revoked (idempotent re-revoke). */
  already_revoked: boolean;
}

export async function listContractGuests(
  contractId: string,
): Promise<HostGuestBindingRow[]> {
  const response = await api.get(`/guest-access/${contractId}/guests`);
  return response.data;
}

export async function revokeGuestAccess(
  contractId: string,
  userId: string,
): Promise<GuestBindingRevocation> {
  const response = await api.post(`/guest-access/${contractId}/revoke`, {
    user_id: userId,
  });
  return response.data;
}
