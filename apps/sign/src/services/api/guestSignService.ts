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
 * The classified outcome of an Accept & Execute attempt. The confirm modal
 * branches on `kind` so an IRREVERSIBLE action never shows a misleading
 * "not executed" message when the contract IS executed, and distinguishes a
 * cancelled slip (no point retrying) from a transient blip (retry helps):
 *
 *   success          — fresh execute (200, executed, NOT already-pinned)
 *   already_executed — idempotent replay (200, executed, already-pinned):
 *                      the contract IS executed — treat as SUCCESS.
 *   gone             — 404: the slip is no longer active (voided / revoked /
 *                      binding gone). Uniform 404 by invariant — the copy
 *                      MUST stay generic (never leak which is missing).
 *   transient        — no HTTP response (network / timeout) OR 401: retry /
 *                      reconnect is the right next step.
 *   generic          — any other status (400 / 409 / 5xx) or an unexpected
 *                      2xx shape: neutral fallback, no "not executed" claim.
 */
export type GuestAcceptOutcome =
  | { kind: 'success'; result: GuestAcceptResult }
  | { kind: 'already_executed'; result: GuestAcceptResult }
  | { kind: 'gone' }
  | { kind: 'transient' }
  | { kind: 'generic' };

/**
 * Classify a thrown request error into an accept outcome. Exported for a
 * focused unit test (mirrors classifyGuestChatError). No HTTP response at all
 * (a network error / a `guestHttp` timeout — code ECONNABORTED — or an
 * aborted request) is transient; 404 is gone; 401 folds into transient
 * (reconnect / re-auth); every other HTTP status is generic.
 */
export function classifyAcceptError(
  err: any,
): Extract<GuestAcceptOutcome, { kind: 'gone' | 'transient' | 'generic' }> {
  const status = err?.response?.status;
  if (status === 404) return { kind: 'gone' };
  if (status === 401) return { kind: 'transient' };
  if (status !== undefined) return { kind: 'generic' };
  // No HTTP response — network error, timeout, or aborted request.
  if (err?.code === 'ECONNABORTED' || err?.request) return { kind: 'transient' };
  return { kind: 'generic' };
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
 *
 * Returns a CLASSIFIED outcome instead of throwing so the confirm modal can
 * branch precisely (success / already-executed / gone / transient / generic).
 * A 200 with `already_pinned` is the idempotent replay — the contract IS
 * executed, so it is a SUCCESS, never an error.
 */
export async function acceptAndExecuteContract(
  contractId: string,
  guestJwt: string,
): Promise<GuestAcceptOutcome> {
  try {
    const { data } = await guestHttp.post<GuestAcceptResult>(
      `/guest/contracts/${contractId}/sign-slip/accept`,
      {},
      { headers: { Authorization: `Bearer ${guestJwt}` } },
    );
    if (data?.executed) {
      return {
        kind: data.already_pinned ? 'already_executed' : 'success',
        result: data,
      };
    }
    // A 200 that doesn't report execution is an unexpected shape — do NOT
    // claim success, and do NOT claim "not executed" either.
    return { kind: 'generic' };
  } catch (err) {
    return classifyAcceptError(err);
  }
}
