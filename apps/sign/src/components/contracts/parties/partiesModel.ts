import type {
  ContractParty,
  ContractPartyContact,
} from '@/types';
import type {
  CreatePartyPayload,
  PartyContactPayload,
} from '@/services/api/partyService';

/**
 * Multi-tier T0c-2 — Parties Editor pure model.
 *
 * All non-visual logic lives here so it is unit-testable in isolation: the
 * draft shapes, the FIVE bounded mock-additions, and the draft↔payload
 * mapping. The React components are thin renderers over these functions.
 *
 * The five bounded additions (see the T0c-2 spec):
 *  1. ROLE-CONFIRM gate — `needs_role_confirm` is CLIENT-ONLY working state
 *     (never persisted); Save is blocked while any draft still needs it.
 *  2. SIGNATORY COUNT — `signatoryStats` is DISPLAY-ONLY; it never gates Save.
 *  3. UPLOAD/EXTRACT — not modeled here (UI renders it disabled; no pipeline).
 *  4. ORG FIELD — `org_name` free text for every party; `is_own_org` maps to
 *     organization_id = host org id (host-only; counterparties stay null).
 *  5. VALIDATION — `validateParties` mirrors the real T0c-1 400s (role, contact
 *     email required+format, one-designated-per-signatory-party). org_name
 *     required is enforced client-side per the mock (see the note on
 *     ORG_NAME_REQUIRED — the backend does not yet 400 on empty org_name).
 */

// ── Draft working shapes (client-side editor state) ───────────────────────

export interface DraftContact {
  /** Stable client key for React lists (not sent to the server). */
  key: string;
  name: string;
  title: string;
  email: string;
  is_designated_signatory: boolean;
}

export interface DraftParty {
  /** Stable client key for React lists. */
  key: string;
  /** Server id, or null for a not-yet-saved party. */
  id: string | null;
  role_code: string; // '' = unset
  org_name: string;
  is_signatory: boolean;
  /** true → organization_id = host org id (host-only link, item 4). */
  is_own_org: boolean;
  legal_tax_card: string;
  legal_address: string;
  contacts: DraftContact[];
  /**
   * Item 1: AI-prefilled parties land needing role confirmation. CLIENT-ONLY —
   * manually-added parties are false; loaded-from-server parties are false.
   */
  needs_role_confirm: boolean;
}

// ── Validation (item 5) ───────────────────────────────────────────────────

export type PartyIssueCode =
  | 'ORG_NAME_REQUIRED'
  | 'ROLE_REQUIRED'
  | 'CONTACT_EMAIL_REQUIRED'
  | 'CONTACT_EMAIL_INVALID'
  | 'MULTIPLE_DESIGNATED';

export interface PartyIssue {
  partyKey: string;
  /** Set for contact-scoped issues. */
  contactKey?: string;
  code: PartyIssueCode;
}

/**
 * Loose email format — deliberately permissive, matching class-validator's
 * @IsEmail acceptance well enough for a pre-flight check (the server is the
 * authority; this only spares a round-trip and drives the inline state).
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Compute the live issue list. Mirrors the T0c-1 API 400s 1:1 — plus the
 * org_name-required rule the mock shows (flagged: the backend does not yet
 * reject empty org_name; role + contact email + one-designated ARE real 400s).
 *
 * Contacts are only validated for SIGNATORY parties (the contacts section is
 * hidden otherwise, and a non-signatory party is sent with no contacts).
 */
export function validateParties(parties: DraftParty[]): PartyIssue[] {
  const issues: PartyIssue[] = [];
  for (const p of parties) {
    if (!p.org_name.trim()) {
      issues.push({ partyKey: p.key, code: 'ORG_NAME_REQUIRED' });
    }
    if (!p.role_code) {
      issues.push({ partyKey: p.key, code: 'ROLE_REQUIRED' });
    }
    if (p.is_signatory) {
      let designated = 0;
      for (const c of p.contacts) {
        if (c.is_designated_signatory) designated += 1;
        const email = c.email.trim();
        if (!email) {
          issues.push({
            partyKey: p.key,
            contactKey: c.key,
            code: 'CONTACT_EMAIL_REQUIRED',
          });
        } else if (!EMAIL_RE.test(email)) {
          issues.push({
            partyKey: p.key,
            contactKey: c.key,
            code: 'CONTACT_EMAIL_INVALID',
          });
        }
      }
      // Backend rejects >1 designated per party (assertDesignatedSignatoryInvariant).
      if (designated > 1) {
        issues.push({ partyKey: p.key, code: 'MULTIPLE_DESIGNATED' });
      }
    }
  }
  return issues;
}

// ── Signatory count (item 2 — DISPLAY ONLY, never gates Save) ──────────────

export interface SignatoryStats {
  /** Parties with is_signatory = true. */
  signatoryCount: number;
  /** Of those, how many name a designated-signatory contact. */
  designatedCount: number;
}

export function signatoryStats(parties: DraftParty[]): SignatoryStats {
  let signatoryCount = 0;
  let designatedCount = 0;
  for (const p of parties) {
    if (!p.is_signatory) continue;
    signatoryCount += 1;
    if (p.contacts.some((c) => c.is_designated_signatory)) designatedCount += 1;
  }
  return { signatoryCount, designatedCount };
}

// ── Role-confirm gate (item 1) ─────────────────────────────────────────────

export function pendingRoleConfirmCount(parties: DraftParty[]): number {
  return parties.filter((p) => p.needs_role_confirm).length;
}

/**
 * Save is allowed only when there are no validation issues AND no party still
 * needs role confirmation. The signatory COUNT never participates (item 2).
 * Emptiness is allowed (saving an empty set is a valid no-op the caller may
 * short-circuit) — the caller decides whether an empty save is meaningful.
 */
export function canSaveParties(parties: DraftParty[]): boolean {
  return (
    validateParties(parties).length === 0 &&
    pendingRoleConfirmCount(parties) === 0
  );
}

// ── Draft ↔ server mapping ────────────────────────────────────────────────

let seq = 0;
/** Monotonic client key generator (avoids Math.random / Date.now). */
export function nextKey(prefix = 'k'): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

export function emptyContact(): DraftContact {
  return {
    key: nextKey('c'),
    name: '',
    title: '',
    email: '',
    is_designated_signatory: false,
  };
}

export function emptyParty(): DraftParty {
  return {
    key: nextKey('p'),
    id: null,
    role_code: '',
    org_name: '',
    is_signatory: false,
    is_own_org: false,
    legal_tax_card: '',
    legal_address: '',
    contacts: [],
    needs_role_confirm: false, // manually added → valid on entry
  };
}

function contactFromServer(c: ContractPartyContact): DraftContact {
  return {
    key: nextKey('c'),
    name: c.name ?? '',
    title: c.title ?? '',
    email: c.email ?? '',
    is_designated_signatory: !!c.is_designated_signatory,
  };
}

/**
 * Map a persisted ContractParty into an editor draft. Loaded parties are
 * always confirmed (needs_role_confirm = false) — the pending state only
 * arises from an AI-prefill prop, never from the server.
 */
export function draftFromServer(
  p: ContractParty,
  hostOrgId: string | null,
): DraftParty {
  return {
    key: nextKey('p'),
    id: p.id,
    role_code: p.role_code ?? '',
    org_name: p.org_name ?? '',
    is_signatory: !!p.is_signatory,
    is_own_org: !!p.organization_id && p.organization_id === hostOrgId,
    legal_tax_card: p.legal_tax_card ?? '',
    legal_address: p.legal_address ?? '',
    contacts: (p.contacts ?? []).map(contactFromServer),
    needs_role_confirm: false,
  };
}

/**
 * Build the create/update payload from a draft. Contacts are included ONLY for
 * signatory parties (a non-signatory party is sent with contacts: [] so the
 * backend's designated-on-non-signatory guard can never fire); org link is the
 * host org id only when is_own_org (never a foreign org).
 */
export function buildPayload(
  p: DraftParty,
  hostOrgId: string | null,
): CreatePartyPayload {
  const contacts: PartyContactPayload[] = p.is_signatory
    ? p.contacts.map((c) => ({
        name: c.name.trim(),
        email: c.email.trim(),
        title: c.title.trim() ? c.title.trim() : null,
        is_designated_signatory: c.is_designated_signatory,
      }))
    : [];
  return {
    role_code: p.role_code,
    org_name: p.org_name.trim(),
    is_signatory: p.is_signatory,
    organization_id: p.is_own_org ? hostOrgId : null,
    legal_tax_card: p.legal_tax_card.trim() ? p.legal_tax_card.trim() : null,
    legal_address: p.legal_address.trim() ? p.legal_address.trim() : null,
    contacts,
  };
}
