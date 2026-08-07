/**
 * Settings hub — the pure entry model (Slice A1).
 *
 * This module is the SINGLE place that decides which settings entries a given
 * role may see. `SettingsPage` is a dumb renderer over `buildSettingsEntries`.
 *
 * Role gating is EXACT-MATCH on `UserRole.OWNER_ADMIN`, deliberately NOT a
 * hierarchy — it mirrors the API's `RolesGuard`, which is exact-match
 * membership (`requiredRoles.includes(user.role)`), so even SYSTEM_ADMIN is
 * excluded from OWNER_ADMIN-gated surfaces. Keeping the UI gate identical to
 * the API gate means the hub never links a user to a page that will 403/redirect.
 *
 * Pure + dependency-free by design: no React, no i18n runtime, no components.
 * It emits i18n KEYS (`titleKey` / `descriptionKey`); resolving them is the
 * renderer's job.
 */
import { UserRole } from '@/types';

export type SettingsGroup = 'workspace' | 'personal';

export interface SettingsEntry {
  /** Stable key, also used to derive the i18n keys. */
  id: string;
  group: SettingsGroup;
  /** Route to navigate to. Every path is an existing, registered route. */
  path: string;
  titleKey: string;
  descriptionKey: string;
  /** True → visible ONLY to UserRole.OWNER_ADMIN (exact match). */
  adminOnly: boolean;
}

/**
 * The full catalogue, in render order: WORKSPACE group first, then PERSONAL.
 *
 * `adminOnly` mirrors the route-level `ProtectedRoute allowedRoles={[OWNER_ADMIN]}`
 * guards in App.tsx for `settings/playbook` and `erp-connections`.
 */
const ALL_SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // ─── Workspace (org-level) ───────────────────────────────────
  {
    id: 'playbook',
    group: 'workspace',
    path: '/app/settings/playbook',
    titleKey: 'settings.items.playbook.title',
    descriptionKey: 'settings.items.playbook.description',
    adminOnly: true,
  },
  {
    id: 'team',
    group: 'workspace',
    path: '/app/team',
    titleKey: 'settings.items.team.title',
    descriptionKey: 'settings.items.team.description',
    adminOnly: false,
  },
  {
    id: 'subscription',
    group: 'workspace',
    path: '/app/settings/subscription',
    titleKey: 'settings.items.subscription.title',
    descriptionKey: 'settings.items.subscription.description',
    adminOnly: false,
  },
  {
    id: 'erpConnections',
    group: 'workspace',
    path: '/app/erp-connections',
    titleKey: 'settings.items.erpConnections.title',
    descriptionKey: 'settings.items.erpConnections.description',
    adminOnly: true,
  },
  // ─── Personal (user-level) ───────────────────────────────────
  {
    id: 'profile',
    group: 'personal',
    path: '/app/profile',
    titleKey: 'settings.items.profile.title',
    descriptionKey: 'settings.items.profile.description',
    adminOnly: false,
  },
  {
    id: 'communications',
    group: 'personal',
    path: '/app/settings/communications',
    titleKey: 'settings.items.communications.title',
    descriptionKey: 'settings.items.communications.description',
    adminOnly: false,
  },
  {
    id: 'security',
    group: 'personal',
    path: '/app/settings/security',
    titleKey: 'settings.items.security.title',
    descriptionKey: 'settings.items.security.description',
    adminOnly: false,
  },
  {
    id: 'billing',
    group: 'personal',
    path: '/app/settings/billing',
    titleKey: 'settings.items.billing.title',
    descriptionKey: 'settings.items.billing.description',
    adminOnly: false,
  },
];

/**
 * Returns the settings entries visible to `role`, in render order.
 *
 * A null/undefined role (not yet hydrated, or no role) sees only the
 * non-adminOnly entries — fail-closed, never fail-open.
 */
export function buildSettingsEntries(
  role: UserRole | null | undefined,
): SettingsEntry[] {
  return ALL_SETTINGS_ENTRIES.filter(
    (entry) => !entry.adminOnly || role === UserRole.OWNER_ADMIN,
  );
}
