import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LoadingSpinnerStyled } from '@/components/common/LoadingSpinner';
import LanguageToggle from '@/components/common/LanguageToggle';
import GuestLayout from '@/components/guest/GuestLayout';
import SharedContractRowItem from '@/components/sharedWithMe/SharedContractRowItem';
import { getMyGuestContracts } from '@/services/api/guestService';
import { clearGuestSession, getGuestSession } from '@/services/guestSession';

/**
 * Guest Dashboard (#8c) — the "home" a signed-in pure guest (org-less,
 * account_type=GUEST) lands on. Lists EVERY contract shared with them across
 * ALL organizations, in every status.
 *
 * SESSION POSTURE (#8c Part 1, CTO-approved): this page runs entirely on the
 * GUEST session — the sessionStorage-only store written by establish-identity
 * (services/guestSession.ts) — and fetches over the ISOLATED `guestHttp`
 * client with an explicit Bearer, the same pattern as every other guest
 * surface (comments / chat / upload / download). It never reads the shared
 * redux auth store or the shared `api` client, so a guest token can never
 * ride the managing client's refresh rotation or login redirect. No guest
 * session (absent or expired ~1h TTL) → the session-ended state; a returning
 * guest re-clicks their invitation link for a fresh session.
 *
 * The managing-side analog remains SharedWithMePage (#8b) on the normal authed
 * stack — same endpoint, same row component, different session world.
 */
export default function GuestDashboardPage() {
  const { t } = useTranslation();
  // Read once per render pass; bump() re-reads after sign-out.
  const [sessionTick, setSessionTick] = useState(0);
  void sessionTick;
  const session = getGuestSession();

  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // Guest-session cache, keyed apart from the managing SharedWithMePage's
    // ['guest-my-contracts'] entry — different client, different credential.
    queryKey: ['guest-my-contracts', 'guest-session'],
    queryFn: () => getMyGuestContracts(session!.token),
    enabled: !!session,
  });

  const handleSignOut = () => {
    // Clears ONLY the guest session (never the managing redux/localStorage
    // slots — a signed-in manager in another tab is untouched).
    clearGuestSession();
    setSessionTick((n) => n + 1);
  };

  // Header controls unique to the dashboard (the viewer pages don't have them):
  // language toggle, the guest's email, and sign-out. Rendered next to the
  // read-only pill GuestLayout already provides.
  const headerRight = (
    <>
      <LanguageToggle />
      {session?.user.email && (
        <span
          className="hidden max-w-[180px] truncate text-sm text-gray-500 lg:inline"
          dir="ltr"
          title={session.user.email}
        >
          {session.user.email}
        </span>
      )}
      {session && (
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
        >
          <svg
            className="h-3.5 w-3.5 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {t('guest.dashboard.signOut')}
        </button>
      )}
    </>
  );

  // No live guest session (never established in this tab, signed out, or the
  // ~1h token expired) → the honest ended state. Return is the invitation
  // link — there is deliberately NO link-less guest login to send them to.
  if (!session) {
    return (
      <GuestLayout headerRight={<LanguageToggle />}>
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">
            ⏳
          </div>
          <h1 className="text-base font-semibold text-gray-900" dir="auto">
            {t('guest.dashboard.sessionEnded.title')}
          </h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-600" dir="auto">
            {t('guest.dashboard.sessionEnded.body')}
          </p>
        </div>
      </GuestLayout>
    );
  }

  return (
    <GuestLayout headerRight={headerRight}>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('guest.dashboard.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('guest.dashboard.subtitle')}</p>
      </div>

      {/* The shared-contracts card */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h2 className="text-[15px] font-semibold text-gray-900">{t('guest.dashboard.cardTitle')}</h2>
            {rows && rows.length > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {rows.length}
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
            <LoadingSpinnerStyled size="lg" />
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-red-600">{t('guest.dashboard.error.title')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('guest.dashboard.error.subtitle')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {t('guest.dashboard.error.retry')}
            </button>
          </div>
        ) : rows && rows.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {rows.map((row) => (
              <SharedContractRowItem key={row.contract_id} row={row} />
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50">
              <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500">{t('guest.dashboard.empty.title')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('guest.dashboard.empty.subtitle')}</p>
          </div>
        )}
      </div>
    </GuestLayout>
  );
}
