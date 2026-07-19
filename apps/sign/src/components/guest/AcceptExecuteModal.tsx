import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ModalShell from '@/components/obligations/ModalShell';
import {
  acceptAndExecuteContract,
  GuestAcceptResult,
} from '@/services/api/guestSignService';

/**
 * Guest Signing v1 — the "Accept & Execute" confirmation modal.
 *
 * Nothing executes without an explicit Confirm (this is a legally-significant
 * action — the InvitePartyDialog safety pattern):
 *   • a synchronous in-flight ref guards the confirm — two same-tick clicks
 *     produce exactly ONE POST; it resets in `finally` so a deliberate retry
 *     after failure genuinely re-POSTs;
 *   • close is inert while executing;
 *   • the backend RE-CHECKS binding + slip on the call — this modal is UX,
 *     never the authority. Idempotent server-side: a double-submit returns
 *     the recorded acceptance rather than erroring.
 */
export default function AcceptExecuteModal({
  contractId,
  contractName,
  guestJwt,
  onClose,
  onExecuted,
}: {
  contractId: string;
  contractName: string;
  guestJwt: string;
  onClose: () => void;
  onExecuted: (result: GuestAcceptResult) => void;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<GuestAcceptResult | null>(null);
  const inFlight = useRef(false);

  const handleClose = () => {
    if (executing) return; // inert mid-flight
    onClose();
  };

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setExecuting(true);
    setError(false);
    try {
      const res = await acceptAndExecuteContract(contractId, guestJwt);
      setResult(res);
      onExecuted(res);
    } catch {
      // No-leak generic error — the guest surface never surfaces backend
      // detail; the slip may also have been voided meanwhile (404), which
      // the parent's refetch will reflect once the modal closes.
      setError(true);
    } finally {
      inFlight.current = false;
      setExecuting(false);
    }
  };

  // ── Success state ──
  if (result) {
    return (
      <ModalShell
        isOpen
        title={t('guest.sign.modal.successTitle')}
        onClose={onClose}
        size="sm"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              data-testid="sign-success-close"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              {t('guest.sign.modal.close')}
            </button>
          </div>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <p className="text-sm text-gray-600">
            {t('guest.sign.modal.successBody')}
          </p>
          {result.accepted_content_hash && (
            <p
              className="max-w-full break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-400"
              dir="ltr"
            >
              {result.accepted_content_hash}
            </p>
          )}
        </div>
      </ModalShell>
    );
  }

  // ── Confirm state ──
  return (
    <ModalShell
      isOpen
      title={t('guest.sign.modal.title')}
      onClose={handleClose}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={executing}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('guest.sign.modal.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={executing}
            data-testid="sign-confirm"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {executing
              ? t('guest.sign.modal.executing')
              : t('guest.sign.modal.confirm')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* WHO/WHAT echo — the contract being executed, unambiguous. */}
        <p
          className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm font-medium text-gray-800"
          dir="auto"
          style={{ unicodeBidi: 'plaintext', overflowWrap: 'anywhere' }}
        >
          {contractName}
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-800">
            {t('guest.sign.modal.warnTitle')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            {t('guest.sign.modal.warnBody')}
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {t('guest.sign.modal.error')}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
