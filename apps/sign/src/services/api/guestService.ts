import { guestHttp } from './guestHttp';
import api from './axios';
import type { User } from '@/types';
import type { SharedContractRow } from './sharedContractsService';

// ─── Response shapes (mirror backend guest-portal controllers) ──────────────

export interface ViewerCredential {
  viewer_token: string;
  viewer_expires_at: string;
  contract_id: string;
  invited_language: string;
  /**
   * #8c Part 1 — the invited email already has a SIGN account (plain boolean,
   * never account_type/role/name). Drives the returning-guest modal state
   * ("enter your password") and the returning-only dashboard navigation.
   */
  account_exists: boolean;
}

export interface GuestIdentityResume {
  kind: 'COMMENT' | 'SIGN' | 'UPLOAD' | null;
  route: string | null;
  created_comment_id?: string;
}

export interface GuestIdentity {
  user: User;
  /**
   * Null when `requires_login` is true — unified membership: an existing
   * REAL account with MFA enabled gets its binding attached but NO session
   * from this endpoint (they sign in through the normal login, MFA intact).
   */
  access_token: string | null;
  refresh_token: string | null;
  /** Set for MFA-enabled real accounts: binding attached, sign in normally. */
  requires_login?: boolean;
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

/**
 * #8c Part 1 — the guest dashboard's bindings list, on the ISOLATED guestHttp
 * client with an EXPLICIT Bearer (the guest-surface pattern: comments / chat /
 * upload / download). Same endpoint + row shape as the managing-side
 * `getMyShares` (sharedContractsService), but it never touches the shared
 * `api` client, its redux token, its refresh rotation, or its login redirect.
 */
export async function getMyGuestContracts(
  guestJwt: string,
): Promise<SharedContractRow[]> {
  const { data } = await guestHttp.get<SharedContractRow[]>(
    '/guest/my-contracts',
    { headers: { Authorization: `Bearer ${guestJwt}` } },
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

/**
 * Sanitized document status returned by the guest status poll. Mirrors the
 * backend GuestStatusController projection — NEVER the full entity (no host
 * org_id / reservation_id / extracted_text leak to the guest).
 */
export interface GuestDocumentStatus {
  id: string;
  processing_status: string;
  quality_flags: string[] | null;
  error_message: string | null;
  page_count: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Poll the extraction status of a guest's OWN new-version upload (Slice 1).
 *
 * This is the guest sibling of the managing
 * `GET /contracts/:id/documents/:docId/status` route. It is the ONLY thing that
 * drives the extraction pipeline forward for a guest upload — the managing route
 * is walled by the org and a guest's null org can never pass it. Walled by the
 * guest CONTRACT BINDING + ownership of the doc (404 on any mismatch — no
 * existence leak). Sends `Authorization: Bearer <guest_jwt>` explicitly on the
 * isolated client (same credential isolation as `postGuestComment`).
 */
export async function getGuestDocumentStatus(
  contractId: string,
  guestJwt: string,
  docId: string,
): Promise<GuestDocumentStatus> {
  const { data } = await guestHttp.get<GuestDocumentStatus>(
    `/guest/contracts/${contractId}/documents/${docId}/status`,
    { headers: { Authorization: `Bearer ${guestJwt}` } },
  );
  return data;
}

/** The import result — the copy's id drives "Open my copy" navigation (#8d). */
export interface ImportedContractResult {
  id: string;
  name: string;
  project_id: string;
}

/**
 * Import a shared contract into the caller's OWN workspace (#8d).
 *
 * POST /guest/contracts/:id/import — binding-walled (the guest_contract_access
 * binding is the sole grant; a revoked binding → uniform 404), copies the
 * guest-visible content (contract scalars + live clauses) into a project of
 * the CALLER'S org as a fresh DRAFT. The source is untouched and un-notified.
 *
 * Rides the isolated `guestHttp` client with an explicit per-request Bearer —
 * on the shared-viewer surface `guestJwt` carries the MANAGING access token
 * (Model A; see the prop note in SharedContractViewerPage).
 */
export async function importSharedContract(
  contractId: string,
  guestJwt: string,
  destinationProjectId: string,
): Promise<ImportedContractResult> {
  const { data } = await guestHttp.post<ImportedContractResult>(
    `/guest/contracts/${contractId}/import`,
    { destinationProjectId },
    { headers: { Authorization: `Bearer ${guestJwt}` } },
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
