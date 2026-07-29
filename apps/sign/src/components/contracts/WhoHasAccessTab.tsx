import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import ModalShell from '@/components/obligations/ModalShell';
import Button from '@/components/common/Button';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  listContractGuests,
  revokeGuestAccess,
  type HostGuestBindingRow,
} from '@/services/api/guestAccessService';

/**
 * #8c Part 4b — the host's "Who has access" tab on ContractDetailPage.
 *
 * Lists the contract's guest bindings (ACTIVE + REVOKED — revoked rows stay,
 * de-emphasized, never vanish; the backend list is deliberately
 * revocation-inclusive) and lets the host revoke an active guest via a
 * confirm modal (ModalShell + the danger Button).
 *
 * Data: ['contract-guests', contractId]. On a confirmed revoke the row flips
 * to Revoked IN PLACE via setQueryData from the endpoint's returned stamp
 * (idempotent POST /guest-access/:id/revoke), then the query is invalidated
 * for truth on next focus.
 *
 * RTL: layout mirrors via the app's dir wiring; emails + dates stay LTR
 * (dir="ltr"); free-text names carry dir="auto" + unicodeBidi:'plaintext'.
 */

/**
 * Access pill — the real pill geometry (ContractStatusDot / SignaturePill:
 * `inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs
 * font-medium` + 6px leading dot), with Active/Revoked palettes.
 */
function AccessPill({ revoked }: { revoked: boolean }) {
  const { t } = useTranslation();
  return revoked ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
      {t('contract.guests.pillRevoked')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {t('contract.guests.pillActive')}
    </span>
  );
}

export default function WhoHasAccessTab({ contractId }: { contractId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Which guest the revoke-confirm modal is open for (null = closed).
  const [confirmGuest, setConfirmGuest] = useState<HostGuestBindingRow | null>(
    null,
  );
  const [revokeError, setRevokeError] = useState(false);
  // Synchronous in-flight guard (lesson #238): a same-tick double-click on
  // Confirm produces exactly ONE POST; released in onSettled so a deliberate
  // retry after failure genuinely re-POSTs.
  const revokeInFlight = useRef(false);

  const {
    data: guests,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['contract-guests', contractId],
    queryFn: () => listContractGuests(contractId),
  });

  const revokeMutation = useMutation({
    mutationFn: (guest: HostGuestBindingRow) =>
      revokeGuestAccess(contractId, guest.user_id),
    onSuccess: (stamp, guest) => {
      // Flip the row to Revoked IN PLACE from the returned stamp — the row
      // never vanishes; counts derive from the same data and follow.
      qc.setQueryData<HostGuestBindingRow[]>(
        ['contract-guests', contractId],
        (rows) =>
          rows?.map((r) =>
            r.user_id === guest.user_id
              ? { ...r, revoked_at: stamp.revoked_at }
              : r,
          ),
      );
      qc.invalidateQueries({ queryKey: ['contract-guests', contractId] });
      setConfirmGuest(null);
      toast.success(
        t('contract.guests.toastRevoked', { email: guest.guest_email }),
      );
    },
    onError: () => setRevokeError(true),
    onSettled: () => {
      revokeInFlight.current = false;
    },
  });

  const confirmRevoke = () => {
    if (!confirmGuest || revokeInFlight.current) return;
    revokeInFlight.current = true;
    setRevokeError(false);
    revokeMutation.mutate(confirmGuest);
  };

  const closeConfirm = () => {
    if (revokeMutation.isPending) return; // inert mid-flight
    setConfirmGuest(null);
    setRevokeError(false);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-red-100 bg-red-50/50 p-10 text-center">
        <p className="text-sm font-medium text-red-700">
          {t('contract.guests.error')}
        </p>
        <button
          onClick={() => refetch()}
          className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('contract.guests.retry')}
        </button>
      </div>
    );
  }

  const rows = guests ?? [];
  const activeCount = rows.filter((g) => !g.revoked_at).length;
  const revokedCount = rows.length - activeCount;

  return (
    <div className="space-y-4">
      {/* Header: title + counts + subtitle */}
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold text-gray-900">
            {t('contract.guests.title')}
          </h2>
          {rows.length > 0 && (
            <span className="text-sm text-gray-400">
              {activeCount === 1
                ? t('contract.guests.guestCountOne')
                : t('contract.guests.guestCountMany', { count: activeCount })}
              {revokedCount > 0 && (
                <span className="text-gray-400">
                  {' '}
                  {t('contract.guests.revokedCount', { count: revokedCount })}
                </span>
              )}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          {t('contract.guests.subtitle')}
        </p>
      </div>

      {rows.length === 0 ? (
        /* Empty state — the app's dashed empty-card style */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <svg
            className="mb-3 h-8 w-8 text-gray-300"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"
            />
          </svg>
          <h3 className="text-base font-semibold text-gray-700">
            {t('contract.guests.empty')}
          </h3>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            {t('contract.guests.emptySub')}
          </p>
        </div>
      ) : (
        /* Guest rows card */
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-card">
          <ul className="divide-y divide-gray-100">
            {rows.map((g) => {
              const revoked = !!g.revoked_at;
              return (
                <li
                  key={g.user_id}
                  className={`flex items-center gap-4 px-5 py-4 ${
                    revoked ? 'bg-gray-50/60' : ''
                  }`}
                >
                  {/* Avatar tile — soft primary tint (gray when revoked) */}
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                      revoked
                        ? 'bg-gray-100 text-gray-500'
                        : 'bg-primary/10 text-primary'
                    }`}
                    aria-hidden="true"
                  >
                    {g.guest_email.charAt(0).toUpperCase()}
                  </div>

                  {/* Identity + provenance */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm ${
                        revoked
                          ? 'font-medium text-gray-500'
                          : 'font-semibold text-gray-900'
                      }`}
                      dir="ltr"
                      style={{ unicodeBidi: 'isolate' }}
                    >
                      {g.guest_email}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-400">
                      {g.granted_by_name && (
                        <>
                          {t('contract.guests.invitedBy')}{' '}
                          <span
                            dir="auto"
                            style={{ unicodeBidi: 'plaintext' }}
                          >
                            {g.granted_by_name}
                          </span>
                          {' · '}
                        </>
                      )}
                      {t('contract.guests.sharedOn')}{' '}
                      <span dir="ltr">
                        {new Date(g.granted_at).toLocaleDateString()}
                      </span>
                    </p>
                  </div>

                  {/* Status pill */}
                  <AccessPill revoked={revoked} />

                  {/* Action: revoke (active) / revoked-on label (revoked) */}
                  {revoked ? (
                    <span className="text-xs text-gray-400">
                      {t('contract.guests.revokedOn')}{' '}
                      <span dir="ltr">
                        {new Date(g.revoked_at as string).toLocaleDateString()}
                      </span>
                    </span>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setRevokeError(false);
                        setConfirmGuest(g);
                      }}
                    >
                      {t('contract.guests.revoke')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Revoke-confirm modal (real ModalShell + danger Button) */}
      <ModalShell
        isOpen={confirmGuest !== null}
        onClose={closeConfirm}
        title={t('contract.guests.modalTitle')}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirm}
              disabled={revokeMutation.isPending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('contract.guests.modalCancel')}
            </button>
            <Button
              variant="danger"
              onClick={confirmRevoke}
              isLoading={revokeMutation.isPending}
            >
              {t('contract.guests.modalConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {/* Sentence split BEFORE/AFTER the email (the mockup's verified
              structure): Arabic reads «سيفقد {email} إمكانية…» — the verb
              precedes the email — so the email cannot be hardcoded first.
              The email stays an isolated LTR token inside an RTL sentence. */}
          {t('contract.guests.modalBodyBefore')}
          <span
            dir="ltr"
            style={{ unicodeBidi: 'isolate' }}
            className="font-semibold text-gray-900"
          >
            {confirmGuest?.guest_email}
          </span>
          {t('contract.guests.modalBodyAfter')}
        </p>
        {revokeError && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('contract.guests.revokeFailed')}
          </p>
        )}
      </ModalShell>
    </div>
  );
}
