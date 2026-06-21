import { guestHttp } from './guestHttp';
import type { Contract } from '@/types';

/**
 * Viewer-credential read of the invited contract.
 *
 * Sends `Authorization: Viewer <viewer_token>` — NEVER a Bearer JWT. Uses the
 * isolated `guestHttp` instance so the app's Bearer interceptor and 401
 * refresh/redirect never fire on a viewer call. The backend hard-matches the
 * `:id` to the credential's bound contract_id (404 otherwise).
 *
 * The response is a full `Contract` with nested `contract_clauses[]` (each
 * carrying `section_number`, `order_index`, and the `clause`). It is read-only.
 */
export async function getViewerContract(
  contractId: string,
  viewerToken: string,
): Promise<Contract> {
  const { data } = await guestHttp.get<Contract>(
    `/viewer/contracts/${contractId}`,
    { headers: { Authorization: `Viewer ${viewerToken}` } },
  );
  return data;
}
