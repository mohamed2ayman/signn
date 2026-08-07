/**
 * Settings hub — pure entry-model tests (Slice A1).
 *
 * The load-bearing assertion here is the EXACT-MATCH role gate: adminOnly
 * entries are visible to UserRole.OWNER_ADMIN and to NOBODY else — explicitly
 * including SYSTEM_ADMIN, which is higher in the informal hierarchy but is NOT
 * an OWNER_ADMIN. This mirrors the API RolesGuard's exact-match membership.
 */
import { describe, it, expect } from 'vitest';

import { buildSettingsEntries } from './settingsEntries';
import { UserRole } from '@/types';

const ADMIN_ONLY_IDS = ['playbook', 'erpConnections'];
const NON_ADMIN_COUNT = 6;
const TOTAL_COUNT = 8;

const idsFor = (role: UserRole | null | undefined) =>
  buildSettingsEntries(role).map((e) => e.id);

describe('buildSettingsEntries', () => {
  it('OWNER_ADMIN sees all 8 entries, including both admin-only ones', () => {
    const entries = buildSettingsEntries(UserRole.OWNER_ADMIN);

    expect(entries).toHaveLength(TOTAL_COUNT);
    for (const id of ADMIN_ONLY_IDS) {
      expect(entries.map((e) => e.id)).toContain(id);
    }
  });

  it('OWNER_CREATOR sees exactly 6 — no playbook, no erpConnections', () => {
    const ids = idsFor(UserRole.OWNER_CREATOR);

    expect(ids).toHaveLength(NON_ADMIN_COUNT);
    expect(ids).not.toContain('playbook');
    expect(ids).not.toContain('erpConnections');
  });

  it('SYSTEM_ADMIN sees exactly 6 — the gate is EXACT-MATCH, not a hierarchy', () => {
    // SYSTEM_ADMIN outranks OWNER_ADMIN informally, but the API RolesGuard is
    // exact-match membership, so it must NOT receive OWNER_ADMIN-gated entries.
    const ids = idsFor(UserRole.SYSTEM_ADMIN);

    expect(ids).toHaveLength(NON_ADMIN_COUNT);
    expect(ids).not.toContain('playbook');
    expect(ids).not.toContain('erpConnections');
  });

  it('a null role sees exactly the 6 non-admin entries (fail-closed)', () => {
    const ids = idsFor(null);

    expect(ids).toHaveLength(NON_ADMIN_COUNT);
    expect(ids).not.toContain('playbook');
    expect(ids).not.toContain('erpConnections');
  });

  it('an undefined role sees exactly the 6 non-admin entries (fail-closed)', () => {
    const ids = idsFor(undefined);

    expect(ids).toHaveLength(NON_ADMIN_COUNT);
    expect(ids).not.toContain('playbook');
    expect(ids).not.toContain('erpConnections');
  });

  it('OWNER_ADMIN group membership is 4 workspace / 4 personal', () => {
    const entries = buildSettingsEntries(UserRole.OWNER_ADMIN);

    expect(entries.filter((e) => e.group === 'workspace')).toHaveLength(4);
    expect(entries.filter((e) => e.group === 'personal')).toHaveLength(4);
  });

  it('every entry has a non-empty path under /app/', () => {
    for (const entry of buildSettingsEntries(UserRole.OWNER_ADMIN)) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.path.startsWith('/app/')).toBe(true);
    }
  });

  it('every entry carries non-empty i18n keys derived from its id', () => {
    for (const entry of buildSettingsEntries(UserRole.OWNER_ADMIN)) {
      expect(entry.titleKey).toBe(`settings.items.${entry.id}.title`);
      expect(entry.descriptionKey).toBe(`settings.items.${entry.id}.description`);
    }
  });
});
