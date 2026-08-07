/**
 * Sidebar contents guard (Slice A1).
 *
 * Pure test — imports the exported `clientNavItems` array, renders nothing.
 *
 * Its job is to lock in the Settings-hub sidebar trim: Communications,
 * Subscription, ERP Connections and Profile now live in /app/settings and must
 * NOT reappear in the sidebar. Before this file there was no test asserting
 * sidebar contents at all, so that removal would have been unguarded.
 */
import { describe, it, expect } from 'vitest';

import { clientNavItems } from './App';
import { UserRole } from '@/types';

/** Moved into the Settings hub — must never return to the sidebar. */
const MOVED_TO_SETTINGS_HUB = [
  'nav.communications',
  'nav.subscription',
  'nav.erpConnections',
  'nav.profile',
];

const EXPECTED_ORDER = [
  'nav.dashboard',
  'nav.portfolio',
  'nav.projects',
  'nav.sharedWithMe',
  'nav.clauses',
  'nav.knowledge',
  'nav.playbook',
  'nav.obligations',
  'nav.notifications',
  'nav.approvals',
  'nav.team',
  'nav.store',
  'nav.support',
];

const labels = () => clientNavItems.map((i) => i.label);

describe('clientNavItems', () => {
  it('has exactly 13 entries', () => {
    expect(clientNavItems).toHaveLength(13);
  });

  it('is in the expected order', () => {
    expect(labels()).toEqual(EXPECTED_ORDER);
  });

  it('contains none of the four entries moved into the Settings hub', () => {
    for (const moved of MOVED_TO_SETTINGS_HUB) {
      expect(labels()).not.toContain(moved);
    }
  });

  it('nav.playbook retains its OWNER_ADMIN role gate', () => {
    const playbook = clientNavItems.find((i) => i.label === 'nav.playbook');

    expect(playbook).toBeDefined();
    expect(playbook?.roles).toEqual([UserRole.OWNER_ADMIN]);
  });

  it('nav.team is present and has no roles key (visible to everyone)', () => {
    const team = clientNavItems.find((i) => i.label === 'nav.team');

    expect(team).toBeDefined();
    expect(team?.path).toBe('/app/team');
    expect('roles' in (team ?? {})).toBe(false);
  });
});
