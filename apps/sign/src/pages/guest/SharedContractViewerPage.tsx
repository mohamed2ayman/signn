import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import axios from 'axios';
import type { RootState } from '@/store';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import GuestLayout from '@/components/guest/GuestLayout';
import GuestContractView from '@/components/guest/GuestContractView';
import GuestChatPanel from '@/components/guest/GuestChatPanel';
import GuestComments from '@/components/guest/GuestComments';
import {
  getMyShares,
  getSharedContract,
} from '@/services/api/sharedContractsService';

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/**
 * "Shared with me" viewer entry (#8b) — the guest-styled contract view opened
 * from a MANAGING session for a contract another org shared with this user.
 *
 * Thin sibling of GuestViewerPage (which stays byte-identical — the
 * invitation-token flow is untouched). Reuses the same shipped surface:
 * GuestLayout shell + GuestContractView + GuestComments + GuestChatPanel.
 *
 * Entry mode (locked decision, #8b): the contract READ rides the normal
 * authed `api` client — GET /contracts/:id serves a bound cross-org contract
 * via the org-first/binding-fallback dispatch (PR #164), and a revoked
 * binding surfaces as the uniform 404 (the dedicated block below). Guest
 * ACTIONS ride the unchanged guest components with the managing token passed
 * explicitly (see the prop note at the render site).
 */
export default function SharedContractViewerPage() {
  const { t } = useTranslation();
  const { contractId } = useParams<{ contractId: string }>();

  // The managing session's access token, straight from the auth store.
  // Selected (not snapshotted) so a refresh rotation propagates down.
  const managingToken = useSelector((s: RootState) => s.auth.token);
  const currentUser = useSelector((s: RootState) => s.auth.user);

  const [chatOpen, setChatOpen] = useState(false);

  const contractQuery = useQuery({
    queryKey: ['shared-contract', contractId],
    queryFn: () => getSharedContract(contractId as string),
    enabled: !!contractId,
    // 404 is a terminal answer (binding revoked / never existed) — retrying
    // can't change it; other failures get the default retry.
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 2,
  });

  // The banner's provenance (who shared this) comes from the same bindings
  // list the "Shared with me" page uses — shared cache, and on a deep link /
  // refresh it simply fetches (self-scoped, cheap).
  const sharesQuery = useQuery({
    queryKey: ['guest-my-contracts'],
    queryFn: getMyShares,
  });
  const shareRow = sharesQuery.data?.find((r) => r.contract_id === contractId);
  const sharedByOrg = (shareRow?.shared_by_org ?? '').trim() || null;

  const contract = contractQuery.data;

  const guestName = currentUser
    ? `${currentUser.first_name ?? ''} ${currentUser.last_name ?? ''}`.trim() ||
      t('guest.comments.defaultName')
    : t('guest.comments.defaultName');

  // On a guest-surface 401 (the access token lapsed between refreshes),
  // refetch the read through `api` — its interceptor refreshes the session
  // and the rotated token flows back down through the selector above.
  const handleSessionExpired = () => {
    void contractQuery.refetch();
  };

  return (
    <GuestLayout contractName={contract?.name}>
      {contractQuery.isLoading && (
        <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-gray-400">{t('guest.loading')}</p>
        </div>
      )}

      {contractQuery.isError &&
        (isNotFound(contractQuery.error) ? (
          /* Revoked binding — the row existed when the list rendered, but the
             share is gone now (locked decision: a dedicated in-page block; the
             shared GuestErrorScreen belongs to the token path and stays
             untouched). */
          <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center">
            <div className="mb-4 text-5xl" aria-hidden="true">
              ⛔
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('sharedWithMe.revoked.title')}
            </h1>
            <p className="mt-2 text-sm text-gray-500">{t('sharedWithMe.revoked.body')}</p>
            <Link
              to="/app/shared-with-me"
              className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              {t('sharedWithMe.banner.back')}
            </Link>
          </div>
        ) : (
          <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center">
            <div className="mb-4 text-5xl" aria-hidden="true">
              ⚠️
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('sharedWithMe.error.title')}
            </h1>
            <p className="mt-2 text-sm text-gray-500">{t('sharedWithMe.error.subtitle')}</p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => contractQuery.refetch()}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
              >
                {t('sharedWithMe.error.retry')}
              </button>
              <Link
                to="/app/shared-with-me"
                className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                {t('sharedWithMe.banner.back')}
              </Link>
            </div>
          </div>
        ))}

      {contract && managingToken && (
        <>
          {/* The "viewing as guest" context banner — managing arrivals ONLY
              (this page is the only place it renders; the token-entered
              GuestViewerPage never shows it). */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
            <svg
              className="h-4 w-4 flex-shrink-0 text-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <p className="min-w-0 flex-1 text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                {t('sharedWithMe.banner.title')}
              </span>{' '}
              {t('sharedWithMe.banner.body', {
                org: sharedByOrg ?? t('sharedWithMe.banner.orgFallback'),
              })}
            </p>
            <Link
              to="/app/shared-with-me"
              className="inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-600"
            >
              <svg
                className="h-3.5 w-3.5 rtl:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              {t('sharedWithMe.banner.back')}
            </Link>
          </div>

          {/* NOTE — the prop name lies here, deliberately: `guestJwt` carries
              the MANAGING access token. Model A (PR #164): the backend accepts
              BOTH a guest JWT and a bound managing JWT on
              /guest/contracts/:id/* — the guest_contract_access binding, not
              the account type, is the grant. The guest components use this
              value ONLY as an explicit per-request `Authorization: Bearer` on
              the interceptor-free `guestHttp` client, so the managing token
              never leaks into the guest stack's config and no guest credential
              ever touches the app's `api` client. We do NOT rename the prop —
              that would churn shipped guest components (#8b keeps them at zero
              diff). */}
          <GuestContractView
            contract={contract}
            guestJwt={managingToken}
            onAskAi={() => setChatOpen(true)}
          />

          <GuestChatPanel
            contractId={contract.id}
            clauses={(contract.contract_clauses ?? []).map((cc) => ({
              section_number: cc.section_number,
              title: cc.clause?.title ?? null,
              content: cc.clause?.content ?? null,
            }))}
            guestJwt={managingToken}
            isOpen={chatOpen}
            onClose={() => setChatOpen(false)}
            onSessionExpired={handleSessionExpired}
          />

          {/* A managing user HAS an account — the progressive-identity
              ("set a password") CTA from the token flow must never render
              here. Comments are available directly. */}
          <section className="mt-8">
            <GuestComments
              contractId={contract.id}
              guestJwt={managingToken}
              guestName={guestName}
              onSessionExpired={handleSessionExpired}
            />
          </section>
        </>
      )}
    </GuestLayout>
  );
}
