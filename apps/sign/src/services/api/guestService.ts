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

export interface GuestComment {
  id: string;
  contract_id: string;
  contract_clause_id?: string | null;
  parent_comment_id?: string | null;
  user_id: string;
  content: string;
  is_resolved?: boolean;
  created_at: string;
  updated_at?: string;
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
