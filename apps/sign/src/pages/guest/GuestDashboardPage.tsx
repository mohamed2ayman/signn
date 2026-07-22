import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LoadingSpinnerStyled } from '@/components/common/LoadingSpinner';
import LanguageToggle from '@/components/common/LanguageToggle';
import GuestLayout from '@/components/guest/GuestLayout';
import SharedContractRowItem from '@/components/sharedWithMe/SharedContractRowItem';
import { getMyShares } from '@/services/api/sharedContractsService';
import useAuth from '@/hooks/useAuth';

/**
 * Guest Dashboard (#8c) — the "home" a signed-in pure guest (org-less,
 * account_type=GUEST) lands on. Lists EVERY contract shared with them across
 * ALL organizations, in every status.
 *
 * The pure-guest analog of the managing-side "Shared with me" page
 * (SharedWithMePage.tsx, #8b): same data source (GET /guest/my-contracts,
 * keyed on the caller's user id — works for a GUEST or MANAGING JWT alike) and
 * the same shared row component, but rendered in the lighter GuestLayout shell
 * rather than the managing AppLayout.
 *
 * Guest sign-in (#8c Part 1) is a separate build — it will route here after
 * login and populate the same auth store this page reads. For now the page
 * simply renders for any authenticated caller that reaches the route.
 */
export default function GuestDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, refreshUserProfile } = useAuth();

  // Redux `user` is null after a hard page load (only the token is persisted),
  // so the header email would be blank until something hydrates it. Mirror the
  // AppLayout/AdminLayout mount-refresh (CLAUDE.md Known Issue #10) so the
  // guest's email is present whether they arrive from sign-in or a refresh.
  useEffect(() => {
    if (!user) void refreshUserProfile();
  }, [user, refreshUserProfile]);

  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // Shared cache with the managing "Shared with me" page and the
    // shared-viewer banner — one fetch shape serves every binding-list consumer.
    queryKey: ['guest-my-contracts'],
    queryFn: getMyShares,
  });

  const handleSignOut = () => {
    logout();
    navigate('/auth/login');
  };

  // Header controls unique to the dashboard (the viewer pages don't have them):
  // language toggle, the guest's email, and sign-out. Rendered next to the
  // read-only pill GuestLayout already provides.
  const headerRight = (
    <>
      <LanguageToggle />
      {user?.email && (
        <span
          className="hidden max-w-[180px] truncate text-sm text-gray-500 lg:inline"
          dir="ltr"
          title={user.email}
        >
          {user.email}
        </span>
      )}
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
    </>
  );

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
