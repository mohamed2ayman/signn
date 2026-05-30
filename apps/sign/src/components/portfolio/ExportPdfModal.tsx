import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import ModalShell from '@/components/obligations/ModalShell';
import {
  portfolioService,
  PortfolioPeriod,
} from '@/services/api/portfolioService';

/**
 * Phase 7.17 Prompt 2c Bucket 4 — export confirmation modal.
 *
 * Two correctness requirements (locked at Bucket 4 review):
 *   1. Expiry copy MUST say "1 hour" — matches the backend constant
 *      PORTFOLIO_EXPORT_TTL_HOURS = 1 from Bucket 1. Stale "24 hours"
 *      copy is a lie to the user.
 *   2. Recovery expectation: single email delivery, no in-app
 *      notification, no automatic retry. The user's only recovery
 *      path is to re-export from this page — and that's free and
 *      idempotent. The copy must tell them this so they don't sit
 *      waiting for an email that never came or a notification that
 *      will never fire.
 *
 * Both points are reflected in the modal body. The toast that fires
 * on success also names the destination email (captured server-side
 * at request time and echoed back in the response).
 */
export interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: PortfolioPeriod;
  projectId?: string;
  /** Logged-in user's email — shown in the recipient line. */
  userEmail: string;
}

export default function ExportPdfModal({
  isOpen,
  onClose,
  period,
  projectId,
  userEmail,
}: ExportPdfModalProps) {
  const { t } = useTranslation();

  const mutation = useMutation({
    mutationFn: () => portfolioService.requestExport(period, projectId),
    onSuccess: (data) => {
      // Use the SERVER's email from the response — it's the source of
      // truth (captured at request time on the row, which is what the
      // processor will actually email). Fall back to userEmail prop if
      // somehow missing.
      toast.success(
        t('portfolio.export.toast.success', {
          email: data?.email ?? userEmail,
        }),
      );
      onClose();
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      if (status === 429) {
        toast.error(t('portfolio.export.toast.error.rateLimit'));
      } else {
        toast.error(t('portfolio.export.toast.error.generic'));
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.mutate();
  };

  const isSubmitting = mutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={isSubmitting ? () => {} : onClose}
      title={t('portfolio.export.modal.title')}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('portfolio.export.modal.cancel')}
          </button>
          <button
            type="submit"
            form="export-pdf-form"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting
              ? t('portfolio.export.modal.submitting')
              : t('portfolio.export.modal.submit')}
          </button>
        </>
      }
    >
      <form id="export-pdf-form" onSubmit={handleSubmit}>
        <div className="space-y-3 text-sm text-gray-700" dir="auto">
          {/* Recipient — server-side captured at request time. */}
          <p>
            {t('portfolio.export.modal.recipient', { email: userEmail })}
          </p>
          {/* Correctness req 1: 1-hour expiry — matches backend TTL. */}
          <p>{t('portfolio.export.modal.expiry')}</p>
          {/* Correctness req 2: single email delivery, no in-app
              notification, recovery = re-export. */}
          <p className="text-gray-500">
            {t('portfolio.export.modal.recovery')}
          </p>
        </div>
      </form>
    </ModalShell>
  );
}
