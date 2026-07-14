import { useTranslation } from 'react-i18next';

import ModalShell from '@/components/obligations/ModalShell';
import type { ProjectParty } from '@/types';
import { partyStatusKind } from './directoryData';

/**
 * 7.20 Slice 4b — invite confirmation dialog (MANDATORY safety guard a).
 *
 * The backend invite endpoint sends a REAL email on EVERY call with no
 * idempotency or "already invited" guard (recon-confirmed) — so nothing
 * may be sent without an explicit, informed Confirm. This dialog states
 * WHO will be emailed (party name + email, Arabic-safe) and WHAT will
 * happen (send vs resend copy; resend also warns that the backend
 * regenerates the invitation token, killing any previously sent link).
 *
 * While the request is in flight (`isPending`) BOTH buttons are disabled
 * and Escape / click-outside are inert, so the dialog cannot be dismissed
 * or re-confirmed mid-request (safety guard b lives here + in the
 * synchronous ref guard in ProjectPartiesDirectory).
 *
 * Composes the shared ModalShell (CLAUDE.md hard rule — never reinvent
 * the overlay/Escape/scroll-lock pattern per modal).
 */
export default function InvitePartyDialog({
  party,
  isPending,
  onConfirm,
  onCancel,
}: {
  /** The party to invite; null = dialog closed. */
  party: ProjectParty | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (!party) return null;

  const K = 'projectDashboard.directory.parties';
  const isResend = partyStatusKind(party.invitation_status) === 'invited';

  return (
    <ModalShell
      isOpen
      onClose={() => {
        // Mid-flight the dialog must stay put — no Escape/backdrop dismiss.
        if (!isPending) onCancel();
      }}
      title={t(isResend ? `${K}.confirmResendTitle` : `${K}.confirmSendTitle`)}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending
              ? t(`${K}.sending`)
              : t(isResend ? `${K}.confirmResendAction` : `${K}.confirmSendAction`)}
          </button>
        </>
      }
    >
      {/* WHO will be emailed — name + address, Arabic-safe (Rule 7). */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
        <p
          className="text-sm font-semibold text-gray-900"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {party.name}
        </p>
        <p
          className="mt-0.5 text-sm text-gray-600"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {party.email}
        </p>
      </div>

      {/* WHAT will happen. */}
      <p
        className="mt-3 text-sm text-gray-600"
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
      >
        {t(isResend ? `${K}.confirmResendBody` : `${K}.confirmSendBody`, {
          email: party.email,
        })}
      </p>

      {/* Honest resend consequence: the backend regenerates the invitation
          token on every call — the previously sent link stops working. */}
      {isResend && (
        <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t(`${K}.resendNote`)}
        </p>
      )}
    </ModalShell>
  );
}
