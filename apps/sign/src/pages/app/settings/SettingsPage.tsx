/**
 * Settings hub (Slice A1) — the directory page at /app/settings.
 *
 * DUMB RENDERER: every decision (which entries exist, which are admin-only,
 * which this role may see) lives in `buildSettingsEntries`. This file only
 * groups and paints. Adding a settings destination means editing
 * settingsEntries.ts, not this component.
 *
 * The hub itself is NOT route-guarded — it is visible to every authenticated
 * role. Per-entry gating is what hides the admin-only destinations, so a
 * non-admin simply never sees a link they would be bounced from.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '@/store';
import {
  buildSettingsEntries,
  type SettingsEntry,
  type SettingsGroup,
} from './settingsEntries';

/**
 * Per-entry glyph (heroicons-style 24px outline path), keyed by entry id.
 * Kept here rather than in the model so `settingsEntries.ts` stays pure and
 * free of presentation concerns.
 */
const ICON_PATHS: Record<string, string> = {
  playbook:
    'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  team: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  subscription:
    'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z',
  erpConnections:
    'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
  profile:
    'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z',
  communications:
    'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
  security:
    'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  billing:
    'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z',
};

/** Render order of the groups on the page. */
const GROUP_ORDER: SettingsGroup[] = ['workspace', 'personal'];

function SettingsCard({ entry }: { entry: SettingsEntry }) {
  const { t } = useTranslation();

  return (
    <Link
      to={entry.path}
      className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-gray-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {/* Icon tile — same 36px shape/tint as the shared-contract row. */}
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <svg
          className="h-[18px] w-[18px] text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={ICON_PATHS[entry.id]}
          />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
            {t(entry.titleKey)}
          </span>
          {entry.adminOnly && (
            <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {t('settings.adminOnly')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">
          {t(entry.descriptionKey)}
        </span>
      </span>

      {/* Forward chevron — mirrored so it points "forward" in RTL too. */}
      <svg
        className="h-4 w-4 flex-shrink-0 text-gray-300 transition-colors group-hover:text-gray-400 rtl:rotate-180"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const user = useSelector((state: RootState) => state.auth.user);

  const entries = buildSettingsEntries(user?.role);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('settings.subtitle')}</p>
      </header>

      {GROUP_ORDER.map((group) => {
        const groupEntries = entries.filter((entry) => entry.group === group);
        if (groupEntries.length === 0) return null;

        return (
          <section key={group} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t(`settings.groups.${group}`)}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groupEntries.map((entry) => (
                <SettingsCard key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
