import { guestHttp } from './guestHttp';

/**
 * Guest Signing v1 — the SLIP client.
 *
 * A slip is a per-(guest, contract) capability the HOST issues to authorize
 * signing; a bare binding never implies it. The backend authorizes on
 * BINDING + SLIP atomically and answers a uniform 404 on either miss — so a
 * 404 here simply means "no signing offered", the normal case for most
 * viewers, and is mapped to `null` rather than an error.
 *
 * Rides the isolated `guestHttp` client with an explicit per-request Bearer —
 * on the shared-viewer surface `guestJwt` carries the MANAGING access token
 * (Model A; see the prop note in SharedContractViewerPage). The backend
 * RE-CHECKS binding + slip on every call: this client is a render gate, never
 * the authority.
 */

export type GuestSignSlipStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'EXECUTED'
  | 'DECLINED'
  | 'VOIDED';

export interface GuestSignSlip {
  slip_id: string;
  status: GuestSignSlipStatus;
  granted_at: string;
  accepted_at: string | null;
  /** The signer's integrity receipt — set once EXECUTED, null before. */
  accepted_content_hash: string | null;
}

export interface GuestAcceptResult extends GuestSignSlip {
  executed: boolean;
  /** True when the host had already executed the contract — the acceptance
   *  was recorded against the existing pin (not an error). */
  already_pinned: boolean;
}

/**
 * Slip status for this guest+contract — the "Accept & Execute" render gate.
 * `null` = no active slip (uniform 404: no binding, no slip, or a voided
 * slip — indistinguishable by design). Any non-404 failure rethrows.
 */
export async function getGuestSignSlip(
  contractId: string,
  guestJwt: string,
): Promise<GuestSignSlip | null> {
  try {
    const { data } = await guestHttp.get<GuestSignSlip>(
      `/guest/contracts/${contractId}/sign-slip`,
      { headers: { Authorization: `Bearer ${guestJwt}` } },
    );
    return data;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Accept & Execute — consumes the slip: the contract reaches the pinned
 * FULLY_EXECUTED state via the existing pin operation (door GUEST_SIGN).
 * Idempotent: a double-click returns the recorded acceptance, no error.
 */
export async function acceptAndExecuteContract(
  contractId: string,
  guestJwt: string,
): Promise<GuestAcceptResult> {
  const { data } = await guestHttp.post<GuestAcceptResult>(
    `/guest/contracts/${contractId}/sign-slip/accept`,
    {},
    { headers: { Authorization: `Bearer ${guestJwt}` } },
  );
  return data;
}
