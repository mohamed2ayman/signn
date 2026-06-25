import { guestHttp } from './guestHttp';
import api from './axios';
import type { User } from '@/types';

// ─── Response shapes (mirror backend guest-portal controllers) ──────────────

export interface ViewerCredential {
  viewer_token: string;
  viewer_expires_at: string;
  contract_id: string;
  invited_language: string;
}

export interface GuestIdentityResume {
  kind: 'COMMENT' | 'SIGN' | 'UPLOAD' | null;
  route: string | null;
  created_comment_id?: string;
}

export interface GuestIdentity {
  user: User;
  access_token: string;
  refresh_token: string;
  contract_id: string;
  resume: GuestIdentityResume;
}

/**
 * Scrubbed POST-comment response. The backend deliberately returns only these
 * least-privilege fields (no is_internal_note / user_id / is_resolved /
 * parent_comment_id). The author label is supplied locally (the poster is the
 * guest). `user_id` is optional only so the resume-intent seed can carry it.
 */
export interface GuestComment {
  id: string;
  contract_id: string;
  contract_clause_id?: string | null;
  user_id?: string;
  content: string;
  created_at: string;
}

/**
 * Scrubbed comment projection from the guest-visible comments GET. Mirrors the
 * backend `GuestVisibleComment` — author display name + a guest-vs-team flag
 * ONLY (no email / role / account_type). Internal SIGN-team notes are never
 * included (server-side whitelist).
 */
export interface GuestVisibleComment {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  content: string;
  created_at: string;
  author_name: string;
  author_role: 'GUEST' | 'TEAM';
}

export interface CreatedGuestInvitation {
  invitation: {
    id: string;
    contract_id: string;
    invited_email: string;
    invited_language: string;
    status: string;
    expires_at: string;
    created_by: string | null;
    created_at: string;
  };
  token: string;
}

// ─── PUBLIC (token-gated, isolated client) ──────────────────────────────────

/** Exchange an invitation token for a short-lived (15-min) viewer credential. */
export async function exchangeInvitation(token: string): Promise<ViewerCredential> {
  const { data } = await guestHttp.post<ViewerCredential>(
    '/public/guest-invitations/exchange',
    { token },
  );
  return data;
}

export interface EstablishIdentityInput {
  token: string;
  password: string;
  first_name?: string;
  last_name?: string;
  intent?: {
    kind: 'COMMENT' | 'SIGN' | 'UPLOAD';
    comment?: { content: string; contract_clause_id?: string; parent_comment_id?: string };
  };
}

/**
 * Progressive identity — set a password against an invitation token and become
 * a restricted GUEST user. Returns a standard JWT pair (account_type=GUEST).
 */
export async function establishGuestIdentity(
  input: EstablishIdentityInput,
): Promise<GuestIdentity> {
  const { data } = await guestHttp.post<GuestIdentity>(
    '/public/guest-invitations/establish-identity',
    input,
  );
  return data;
}

// ─── GUEST JWT (Bearer, passed explicitly, isolated client) ─────────────────

/**
 * Post a comment as the established guest. Sends `Authorization: Bearer
 * <guest_jwt>` explicitly on the isolated client — the guest JWT is never
 * written to the app store / localStorage, so it can never hijack a
 * managing-user session.
 */
export async function postGuestComment(
  contractId: string,
  guestJwt: string,
  body: { content: string; contract_clause_id?: string; parent_comment_id?: string },
): Promise<GuestComment> {
  const { data } = await guestHttp.post<GuestComment>(
    `/guest/contracts/${contractId}/comments`,
    body,
    { headers: { Authorization: `Bearer ${guestJwt}` } },
  );
  return data;
}

/**
 * Read the guest-VISIBLE conversation on the bound contract (the guest's own
 * comments + SIGN-team replies explicitly marked guest-visible), persisted
 * across sessions. Sends `Authorization: Bearer <guest_jwt>` on the isolated
 * client — same credential isolation as `postGuestComment`. Requires an
 * established guest identity (the guest JWT), so it is only callable
 * post-identity. Internal SIGN-team notes are filtered server-side.
 */
export async function getGuestComments(
  contractId: string,
  guestJwt: string,
): Promise<GuestVisibleComment[]> {
  const { data } = await guestHttp.get<GuestVisibleComment[]>(
    `/guest/contracts/${contractId}/comments`,
    { headers: { Authorization: `Bearer ${guestJwt}` } },
  );
  return data;
}

/**
 * Download a watermarked PDF of the bound contract as the established guest
 * (Feature #3 — visible deterrent). Sends `Authorization: Bearer <guest_jwt>`
 * explicitly on the isolated client (same credential isolation as
 * `postGuestComment`) and streams the PDF blob to a file.
 *
 * Requires an established guest identity — the backend route is
 * account_type=GUEST + binding-gated, and the watermark stamp (guest email +
 * timestamp) is built ENTIRELY server-side from the authenticated principal,
 * never from anything sent here.
 */
export async function downloadGuestContractPdf(
  contractId: string,
  guestJwt: string,
): Promise<void> {
  const response = await guestHttp.get(`/guest/contracts/${contractId}/pdf`, {
    headers: { Authorization: `Bearer ${guestJwt}` },
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `contract-${contractId}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** Scrubbed created-document shape returned by the guest upload route. */
export interface GuestUploadedVersion {
  id: string;
  file_name: string;
  original_name: string | null;
  processing_status: string;
  created_at: string;
}

/**
 * Upload a revised contract version as the established guest (Feature #4).
 *
 * Multipart POST on the isolated client. `guestHttp` defaults to
 * `application/json`, so we override `Content-Type: multipart/form-data` for
 * THIS request only, alongside an explicit `Authorization: Bearer <guest_jwt>`
 * (same credential isolation as `postGuestComment` — the guest JWT is never
 * written to the app store). The file lands as a new document on the bound
 * contract and re-runs AI extraction (metered against the host org's separate
 * guest meter, subject to a 5/day-per-contract cap — the backend returns
 * 429 `{ error: 'GUEST_UPLOAD_DAILY_LIMIT' }` at the limit).
 */
export async function uploadGuestContractVersion(
  contractId: string,
  guestJwt: string,
  file: File,
): Promise<GuestUploadedVersion> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await guestHttp.post<GuestUploadedVersion>(
    `/guest/contracts/${contractId}/documents`,
    fd,
    {
      headers: {
        Authorization: `Bearer ${guestJwt}`,
        'Content-Type': 'multipart/form-data',
      },
    },
  );
  return data;
}

// ─── MANAGING USER (for completeness — uses the normal authenticated client) ─

export interface CreateGuestInvitationInput {
  contract_id: string;
  invited_email: string;
  invited_language?: string;
}

/**
 * Create a guest invitation for a contract the caller's org owns. Uses the
 * shared authenticated `api` client (this is a managing-user action, NOT a
 * guest one) and returns the raw invitation token in the response body. No
 * UI in this first pass calls this — it exists so the contract is complete and
 * an invitation-management screen can wire to it next.
 */
export async function createGuestInvitation(
  input: CreateGuestInvitationInput,
): Promise<CreatedGuestInvitation> {
  const { data } = await api.post<CreatedGuestInvitation>('/guest-invitations', input);
  return data;
}
