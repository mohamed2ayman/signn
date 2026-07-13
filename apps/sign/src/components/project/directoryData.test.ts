/**
 * 7.20 Slice 4a — pure directory derivations (RED-first).
 *
 * Covers the pure helpers behind the Parties & Team directory:
 * status-badge mapping, party-type counts/filter, member display
 * (null/empty handling), initials.
 */
import { describe, it, expect } from 'vitest';

import {
  partyStatusKind,
  PARTY_STATUS_BADGE,
  partyTypeCounts,
  filterPartiesByType,
  memberDisplay,
  initialsOf,
} from './directoryData';
import { PartyType } from '@/types';
import type { ProjectParty, ProjectMember } from '@/types';

// ─── Fixtures ────────────────────────────────────────────────────

function mkParty(overrides: Partial<ProjectParty> = {}): ProjectParty {
  return {
    id: 'party-1',
    project_id: 'p-1',
    owner_organization_id: 'org-1',
    party_organization_id: null,
    party_type: PartyType.CONTRACTOR,
    name: 'Acme Contracting',
    email: 'acme@example.com',
    contact_person: null,
    phone: null,
    invitation_token: null,
    invitation_status: 'PENDING',
    permissions: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function mkMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 'member-1',
    project_id: 'p-1',
    user_id: 'user-1',
    role: 'MEMBER',
    permission_level: null,
    added_at: '2026-07-01T00:00:00.000Z',
    user: {
      id: 'user-1',
      organization_id: 'org-1',
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      role: 'OWNER_CREATOR',
      job_title: null,
      default_permission_level: null,
      is_active: true,
      is_email_verified: true,
      mfa_enabled: false,
      mfa_method: null,
      preferred_language: 'en',
      last_login_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as ProjectMember['user'],
    ...overrides,
  };
}

// ─── Status-badge mapping (the three real invitation_status values) ─

describe('partyStatusKind', () => {
  it('maps ACCEPTED → active', () => {
    expect(partyStatusKind('ACCEPTED')).toBe('active');
  });

  it('maps INVITED → invited', () => {
    expect(partyStatusKind('INVITED')).toBe('invited');
  });

  it('maps PENDING → pending', () => {
    expect(partyStatusKind('PENDING')).toBe('pending');
  });

  it('falls back to pending for unknown values (varchar column, not an enum)', () => {
    expect(partyStatusKind('SOMETHING_ELSE')).toBe('pending');
    expect(partyStatusKind('')).toBe('pending');
  });

  it('has a badge style for every kind (green / amber / gray)', () => {
    expect(PARTY_STATUS_BADGE.active).toMatch(/emerald/);
    expect(PARTY_STATUS_BADGE.invited).toMatch(/amber/);
    expect(PARTY_STATUS_BADGE.pending).toMatch(/gray/);
  });
});

// ─── Party-type counts + filter ──────────────────────────────────

describe('partyTypeCounts', () => {
  it('zero-fills all 6 party types (lesson #210 sparse-array idiom)', () => {
    const counts = partyTypeCounts([]);
    for (const type of Object.values(PartyType)) {
      expect(counts.byType[type]).toBe(0);
    }
    expect(counts.total).toBe(0);
  });

  it('counts parties per type with a correct total', () => {
    const parties = [
      mkParty({ id: 'a', party_type: PartyType.CONTRACTOR }),
      mkParty({ id: 'b', party_type: PartyType.CONTRACTOR }),
      mkParty({ id: 'c', party_type: PartyType.EMPLOYER }),
    ];
    const counts = partyTypeCounts(parties);
    expect(counts.byType[PartyType.CONTRACTOR]).toBe(2);
    expect(counts.byType[PartyType.EMPLOYER]).toBe(1);
    expect(counts.byType[PartyType.SUBCONTRACTOR]).toBe(0);
    expect(counts.total).toBe(3);
  });
});

describe('filterPartiesByType', () => {
  const parties = [
    mkParty({ id: 'a', party_type: PartyType.CONTRACTOR }),
    mkParty({ id: 'b', party_type: PartyType.EMPLOYER }),
    mkParty({ id: 'c', party_type: PartyType.CONTRACTOR }),
  ];

  it("returns all parties for 'ALL'", () => {
    expect(filterPartiesByType(parties, 'ALL')).toHaveLength(3);
  });

  it('returns only the selected type', () => {
    const filtered = filterPartiesByType(parties, PartyType.CONTRACTOR);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((p) => p.party_type === PartyType.CONTRACTOR)).toBe(true);
  });
});

// ─── Member display (null / empty-name handling) ─────────────────

describe('memberDisplay', () => {
  it('returns the full name for a named member', () => {
    const d = memberDisplay(mkMember());
    expect(d.name).toBe('Jane Doe');
    expect(d.isPendingInvitation).toBe(false);
  });

  it('flags an empty-name member as a pending invitation', () => {
    const d = memberDisplay(
      mkMember({
        user: { ...mkMember().user!, first_name: '', last_name: '' },
      }),
    );
    expect(d.isPendingInvitation).toBe(true);
  });

  it('falls back permission level to VIEWER when null (existing matrix pattern)', () => {
    const d = memberDisplay(mkMember({ permission_level: null }));
    expect(d.permissionLevel).toBe('VIEWER');
  });

  it('keeps an explicit permission level when set', () => {
    const d = memberDisplay(
      mkMember({ permission_level: 'APPROVER' as ProjectMember['permission_level'] }),
    );
    expect(d.permissionLevel).toBe('APPROVER');
  });
});

describe('initialsOf', () => {
  it('takes up to two initials from the first two words', () => {
    expect(initialsOf('Acme Contracting')).toBe('AC');
    expect(initialsOf('Jane')).toBe('J');
  });

  it('returns ? for an empty name', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});
