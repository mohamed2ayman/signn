/**
 * Pure directory derivations — 7.20 slice 4a (Parties & Team directory).
 *
 * PURE functions behind ProjectPartiesDirectory: status-badge mapping,
 * party-type counts/filter, member display fallbacks. Kept out of the
 * component so the mappings are unit-testable (the projectHealth.ts /
 * attentionData.ts / dashboardAnalytics.ts convention).
 */
import { PartyType, PermissionLevel } from '@/types';
import type { ProjectParty, ProjectMember } from '@/types';

// ─── Party invitation status → badge ─────────────────────────────

/**
 * The three UI states driven by `invitation_status`. The column is a
 * plain varchar (default 'PENDING'), NOT a PG enum — the service writes
 * exactly PENDING / INVITED / ACCEPTED, but unknown values must not
 * crash a card, so anything unrecognized falls back to 'pending'.
 */
export type PartyStatusKind = 'active' | 'invited' | 'pending';

export function partyStatusKind(invitationStatus: string): PartyStatusKind {
  if (invitationStatus === 'ACCEPTED') return 'active';
  if (invitationStatus === 'INVITED') return 'invited';
  return 'pending';
}

/** Badge colours per status — same palette family as the levelBadge map. */
export const PARTY_STATUS_BADGE: Record<PartyStatusKind, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  invited: 'bg-amber-50 text-amber-700',
  pending: 'bg-gray-100 text-gray-600',
};

// ─── Party-type counts + filter ──────────────────────────────────

export interface PartyTypeCounts {
  total: number;
  /** Zero-filled for ALL 6 types (lesson #210 sparse-data idiom). */
  byType: Record<PartyType, number>;
}

export function partyTypeCounts(parties: ReadonlyArray<ProjectParty>): PartyTypeCounts {
  const byType = Object.values(PartyType).reduce(
    (acc, type) => {
      acc[type] = 0;
      return acc;
    },
    {} as Record<PartyType, number>,
  );
  for (const party of parties) {
    if (party.party_type in byType) byType[party.party_type] += 1;
  }
  return { total: parties.length, byType };
}

export type PartyTypeFilter = PartyType | 'ALL';

export function filterPartiesByType(
  parties: ReadonlyArray<ProjectParty>,
  filter: PartyTypeFilter,
): ProjectParty[] {
  if (filter === 'ALL') return [...parties];
  return parties.filter((p) => p.party_type === filter);
}

// ─── Member display (null / empty-name fallbacks) ────────────────

export interface MemberDisplay {
  name: string;
  email: string;
  /** True when the invited user has not completed registration (empty names). */
  isPendingInvitation: boolean;
  /** Falls back to VIEWER when the row has no explicit level (matrix pattern). */
  permissionLevel: PermissionLevel;
  jobTitle: string | null;
  systemRole: string;
}

export function memberDisplay(member: ProjectMember): MemberDisplay {
  const first = member.user?.first_name?.trim() ?? '';
  const last = member.user?.last_name?.trim() ?? '';
  const name = `${first} ${last}`.trim();
  return {
    name,
    email: member.user?.email ?? '',
    isPendingInvitation: name.length === 0,
    permissionLevel: member.permission_level ?? PermissionLevel.VIEWER,
    jobTitle: member.user?.job_title ?? null,
    systemRole: member.user?.role ?? '',
  };
}

// ─── Initials avatar ─────────────────────────────────────────────

/** Up to two initials from the first two words; '?' when empty. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}
