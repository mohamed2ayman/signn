import api from './axios';
import type { Contract } from '@/types';

/**
 * "Shared with me" (#8b) — the managing-session service layer for contracts
 * OTHER orgs shared with this user (unified membership, PR #164: the
 * `guest_contract_access` binding is the sole cross-org grant).
 *
 * Both calls ride the NORMAL authed `api` client (the caller is a real,
 * logged-in session — token attach, refresh rotation, and the 401→login
 * redirect are all correct behavior here). This is deliberately different
 * from the guest-surface ACTION calls (comments / chat / upload / download),
 * which keep using the interceptor-free `guestHttp` with an explicit
 * per-request Bearer — see SharedContractViewerPage.
 */

/**
 * One row of GET /guest/my-contracts — mirrors the backend's
 * `GuestBindingListRow` projection (#8a) exactly. The two shared-by fields
 * are deliberately UN-COMPOSED nullable atoms (never "" and never a UUID —
 * server-normalized); the frontend composes the display line (lesson #260).
 */
export interface SharedContractRow {
  contract_id: string;
  contract_name: string;
  contract_type: string;
  status: string;
  signature_status: string | null;
  party_first_name: string | null;
  party_second_name: string | null;
  project_name: string | null;
  shared_by_org: string | null;
  shared_by_user: string | null;
  granted_at: string;
}

/** List the caller's guest bindings, newest share first. No bindings → []. */
export async function getMyShares(): Promise<SharedContractRow[]> {
  const { data } = await api.get<SharedContractRow[]>('/guest/my-contracts');
  return data;
}

/**
 * Full read of a bound contract from a managing session.
 *
 * GET /contracts/:id routes through `findAccessibleContract`, which since
 * PR #164 is ORG-FIRST → BINDING-FALLBACK: a cross-org contract the caller
 * holds a binding for is served the same binding-scoped read a guest gets
 * (same shape as the viewer read — clauses included, proposed excluded).
 * A revoked binding surfaces as the uniform 404.
 */
export async function getSharedContract(contractId: string): Promise<Contract> {
  const { data } = await api.get<Contract>(`/contracts/${contractId}`);
  return data;
}
