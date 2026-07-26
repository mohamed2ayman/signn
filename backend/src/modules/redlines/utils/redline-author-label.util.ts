import { AccountType } from '../../../database/entities';

/**
 * 7.19 — the ONE scrubbed author projection, shared by the redline LIST
 * response and Slice 4's notifications.
 *
 * Slice 1 hard rule 5: the author projection is display name + TEAM/GUEST only
 * — never an email, role, or user/org UUID. The TEAM/GUEST flag keys on
 * HOST-ORG MEMBERSHIP, never on `account_type` alone: a MANAGING counterparty
 * acting through a "Shared with me" binding is EXTERNAL, not TEAM.
 *
 * This lives in a util because Slice 4 renders an actor name into an email
 * crossing an org boundary. Two copies of this rule would be two chances to
 * leak; extracting it makes "the notification uses the list's projection" a
 * call to one function rather than a claim in a code comment.
 *
 * Extracted verbatim from RedlineService.list — the list's output is
 * byte-identical before and after the extraction.
 */
export interface RedlineAuthorLabel {
  /** Display name, or the 'SIGN Team' / 'Guest' fallback when no name is set. */
  name: string;
  /** 'TEAM' when the author belongs to the HOST org; 'GUEST' otherwise. */
  role: 'TEAM' | 'GUEST';
}

export function redlineAuthorLabel(
  author: {
    first_name?: string | null;
    last_name?: string | null;
    account_type?: AccountType | null;
    organization_id?: string | null;
  },
  hostOrgId: string | null,
): RedlineAuthorLabel {
  const isTeam =
    author.account_type !== AccountType.GUEST &&
    author.organization_id != null &&
    author.organization_id === hostOrgId;

  const name = [author.first_name, author.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    name: name || (isTeam ? 'SIGN Team' : 'Guest'),
    role: isTeam ? 'TEAM' : 'GUEST',
  };
}
